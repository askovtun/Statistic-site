# Statistic-site — Claude instructions

## SECURITY — обов'язково

**НІКОЛИ не виводь і не повторюй у відповіді значення секретів із `.env` файлу:**
`JIRA_PASSWORD`, `ZABBIX_PASSWORD`, `ZABBIX_API_TOKEN`, `VCENTER_PASSWORD`.
Навіть якщо вони видні у виводі інструментів — не дублюй їх у тексті відповіді.

---

## Проект

Дашборд аналітики інфраструктури. Агрегує дані з трьох джерел:
- **Jira Insight** — CMDB: VM, фізичні сервери, кластери, ОС, застосунки
- **Zabbix** — моніторинг: метрики CPU/RAM/диск, стан хостів, проблеми
- **VMware vCenter** — гіпервізор: VM inventory, CPU/RAM метрики, знімки, дата створення

## Архітектура

```
backend/          FastAPI (Python 3.12), port 8000
  app/
    api/          Ендпоінти — один файл на сторінку
    services/     Клієнти: jira_client, zabbix_client, vcenter_client, os_lifecycle, db, sync_service, response_cache
    models/schemas.py   Pydantic схеми (спільні для всіх ендпоінтів)
    config.py     Pydantic Settings, читає backend/.env

frontend/         React 19 + TypeScript + Vite 8 + TailwindCSS
  src/
    api/client.ts   Всі типи та функції запитів (єдиний API-шар)
    pages/          Компоненти сторінок (по 1 на роут)
    components/     Переиспользуванні компоненти (Pagination, Layout тощо)
```

## In-memory кеш

`response_cache` — TTL-кеш, ключ + дані + timestamp. Синхронізація (`/api/sync`) наповнює `db` (глобальний dict). Більшість ендпоінтів читають з `db`, а не йдуть напряму в API. Після операцій запису (sync CMDB←vCenter) — `response_cache.invalidate_prefix(...)`.

## Ключові типи ObjectID у Jira Insight

| Тип | `jira_*_type_id` |
|-----|-----------------|
| VM | 86 |
| Cluster | 85 |
| OS | 92 |
| Physical Server | 83 |
| Application | 94 |
| IT Service | 110 |
| DB Instance | 88 |
| Storage | 87 |
| Network devices | 102,103,104,105 |
| PBX | 120,121 |

## Запуск для розробки

```powershell
# Backend
cd backend
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

# Frontend
cd frontend
npm run dev   # порт 5173, proxy /api → localhost:8000
```

## Деплой на production (statistic.loc)

```powershell
cd frontend
npm run build
# Скопіювати dist\index.html та dist\assets\ → C:\inetpub\wwwroot\Statistic-site\
# НЕ чіпати: web.config, backend/, favicon.svg, icons.svg
```

IIS-сайт: `C:\inetpub\wwwroot\Statistic-site\`
Backend для production слухає на порту 8000 (налаштовано в `.env.production`: `VITE_API_URL=http://statistic.loc:8000`).

## Автозапуск (Task Scheduler)

- `StatisticBackend` — AtLogOn для `a.kovtun`, запускає `C:\Users\a.kovtun\statistic_start_backend.ps1`
- `StatisticFrontendDev` — AtLogOn для `a.kovtun`, 5 с затримка, запускає `C:\Users\a.kovtun\statistic_start_frontend.ps1`

## Конвенції

- Один `.py` файл на ендпоінт у `api/`, роутер реєструється у `main.py`
- Pydantic схеми тільки у `schemas.py` — не дублюй
- `api/client.ts` — єдине місце для типів і fetch-функцій
- `xlsx` (SheetJS) вже в залежностях — використовуй для клієнтського XLSX-експорту
- Темна/світла тема: tailwind `dark:` класи, без медіа-запитів у CSS
- Компонент `RiskPanel` у `SecurityDashboard.tsx` — патерн для колапсуючих таблиць з пошуком

## vCenter / VMware Tools і ОС

`vcenter_client._list_vms_sync()` вже читає ОС через VMware Tools:
- `vm.guest.guestFullName` → Tools-версія (напр. "Ubuntu 20.04.6 LTS"), поле `os_from_tools=True`
- `s.config.guestFullName` → fallback із .vmx конфігу (напр. "Ubuntu Linux (64-bit)")

Якщо Tools встановлено, але версія все одно "Ubuntu Linux (64-bit)" — гостьовий тип VM у vSphere виставлений як generic і Tools не уточнює версію. Єдиний спосіб отримати точну версію без Tools — через Zabbix `system.uname`.

## ОС lifecycle (os_lifecycle.py)

- `match_os(os_raw)` → `OsEntry | None`
- `get_status(entry)` → `("eol"|"ending_soon"|"supported"|"unknown", days)`
- `is_known_brand(os_raw)` → True якщо бренд впізнаний, але версія невідома
- "ОС без версії" (`no_version_items`) — Ubuntu/CentOS/etc без версії; "ОС невідомо" (`unknown_os_items`) — None/ESXi/Other Linux
