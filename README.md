# Statistic-site

Дашборд аналітики IT-інфраструктури для Єпіцентр К.  
Агрегує дані з трьох джерел: **Jira Insight (CMDB)**, **Zabbix**, **VMware vCenter**.

---

## Зміст

- [Що робить](#що-робить)
- [Архітектура](#архітектура)
- [Джерела даних](#джерела-даних)
- [Запуск та деплой](#запуск-та-деплой)
- [Автозапуск](#автозапуск)
- [Безпека](#безпека)
- [Тести та CI](#тести-та-ci)
- [Домовленості та рішення](#домовленості-та-рішення)

---

## Що робить

| Сторінка | Опис |
|----------|------|
| Dashboard | Зведені лічильники: VM/фіз.сервери, покриття Zabbix, ОС |
| Resources | Метрики CPU/RAM/Disk з Zabbix + vCenter, rightsizing-рекомендації |
| CMDB vs Zabbix | Порівняння інвентарю CMDB і Zabbix — "тільки в CMDB" / "тільки в Zabbix" |
| CMDB vs vCenter | Розбіжності vCPU/vRAM/Cluster між CMDB і vCenter; кнопка синхронізації CMDB ← vCenter |
| Security Dashboard | EOL сервери, ОС без версії, ОС невідомо, VM без моніторингу |
| License Report | Ліцензування Windows Server: DC vs Standard по ESXi-хостах, потенційна економія |
| OS Report | Розподіл ОС по версіях і статусах lifecycle |
| Clusters | Утилізація кластерів vCenter, сховища, рекомендації щодо балансування |
| Capacity Planning | Прогноз ємності CPU/RAM на кластерах |
| Disk Forecast | Прогноз заповнення дисків на основі тренду Zabbix |
| Disk Analytics | Аналіз вільного місця, нормалізація Zabbix disk items |
| Zabbix Problems | Активні проблеми Zabbix з фільтрацією по severity |
| Snapshots | VM-знімки vCenter старші за поріг |
| New VMs (vCenter) | VM створені більше 1 тижня тому, що ще немає в CMDB |
| Zombie Servers | VM вимкнені тривалий час — кандидати на виведення |
| Uptime Report | Статистика доступності хостів з Zabbix |
| Topology Map | Граф залежностей CMDB (ReactFlow) |
| Decommission | VM позначені до деактивації |
| Network Channels | Аналіз мережевих каналів |

---

## Архітектура

```
Браузер → IIS:80 (Windows Auth) → frontend (React SPA)
                                 → /api/* proxy (ARR) → uvicorn 127.0.0.1:8000 (FastAPI)
                                                              ↓
                                                   SQLite cache.db (TTL-кеш)
                                                              ↑
                                              sync_service (кожні 4 год)
                                              ├── jira_client   → Jira Insight REST
                                              ├── zabbix_client → Zabbix API
                                              └── vcenter_client → pyVmomi
```

**Backend:** Python 3.12, FastAPI, uvicorn, httpx, pyVmomi, pydantic-settings  
**Frontend:** React 19, TypeScript, Vite 8, TailwindCSS v4, @tanstack/react-query, recharts, xlsx (SheetJS), @xyflow/react  
**Кеш:** SQLite (`backend/data/cache.db`) + in-memory mirror; `response_cache` (TTL 300с) для ендпоінтів

---

## Джерела даних

| Джерело | Що читаємо | Клієнт |
|---------|-----------|--------|
| Jira Insight | VM, фіз.сервери, кластери, ОС, застосунки, IT-сервіси | `jira_client.py` (httpx + IQL) |
| Zabbix | Хости, метрики CPU/RAM/disk (history + trends), проблеми, uptime | `zabbix_client.py` |
| vCenter | VM inventory, guest OS (VMware Tools), CPU/RAM/disk.usage, snapshots, дата створення | `vcenter_client.py` (pyVmomi PropertyCollector) |

**Пріоритет джерел для OS у Security Dashboard:**  
`vCenter guest.guestFullName` (VMware Tools) > `CMDB os_family` — якщо Tools встановлено і повертає версію, використовується вона.

---

## Запуск та деплой

### Розробка

```powershell
# Backend
cd backend
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload

# Frontend
cd frontend
npm run dev   # порт 5173, proxy /api → localhost:8000
```

### Production (statistic.loc / IIS)

```powershell
cd frontend
npm run build
# Скопіювати dist/index.html та dist/assets/ → C:\inetpub\wwwroot\Statistic-site\
# НЕ чіпати: web.config, favicon.svg, icons.svg
```

**IIS root:** `C:\inetpub\wwwroot\Statistic-site\`  
**Backend:** слухає тільки `127.0.0.1:8000`, IIS проксує через ARR

### Конфігурація

Файл `backend/.env` (не комітити):

```env
JIRA_URL=https://jira.example.com
JIRA_USER=...
JIRA_PASSWORD=...
JIRA_SCHEMA_ID=3
JIRA_VM_TYPE_ID=86
ZABBIX_URL=https://zabbix.example.com
ZABBIX_API_TOKEN=...
VCENTER_HOST=vcenter.example.com
VCENTER_USER=...
VCENTER_PASSWORD=...
CORS_ORIGINS=http://localhost:5173
```

---

## Автозапуск

Після перезавантаження сервера запускається через **Task Scheduler** (AtLogOn для `a.kovtun`):

| Завдання | Скрипт | Затримка |
|----------|--------|----------|
| `StatisticBackend` | `statistic_start_backend.ps1` | — |
| `StatisticFrontendDev` | `statistic_start_frontend.ps1` | 5 с |

---

## Безпека

> **Деплой:** `frontend/public/web.config` копіюється у `dist/` при `npm run build`.
> Не замінюй цей файл в IIS вручну — зміни зробити в репо і перезібрати.

### Стан на 2026-09-18

| Шар | Статус | Деталі |
|-----|--------|--------|
| Windows Auth (IIS) | ✅ В репо | `frontend/public/web.config`: anonymous вимкнено, Windows Auth увімкнено |
| ARR reverse proxy | ⏳ Потрібна ручна дія | Встановити ARR 3.0 + увімкнути proxy в IIS Manager |
| Backend loopback | ✅ Зроблено | uvicorn слухає `127.0.0.1:8000` (не `0.0.0.0`) |
| Firewall порт 8000 | ⏳ Потрібна ручна дія | `New-NetFirewallRule` (потребує admin) |
| Security headers | ✅ В репо | CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy — у `public/web.config` |
| HTTPS/TLS | ❌ Відсутній | Трафік йде по HTTP — розглянути Let's Encrypt або корпоративний CA |

### Встановлення ARR (один раз, від адміністратора)

```
winget install Microsoft.IIS.ARR
```
Або: [iis.net/downloads/microsoft/application-request-routing](https://www.iis.net/downloads/microsoft/application-request-routing)

Після встановлення: IIS Manager → рівень сервера → **Application Request Routing Cache** → **Server Proxy Settings** → ✓ **Enable proxy** → Apply

---

## Тести та CI

```powershell
cd backend
pip install -r requirements.txt -r requirements-test.txt
pytest tests/ -v
```

**39 smoke-тестів** (0.3с):
- `test_os_lifecycle.py` — `match_os`, `get_status`, `is_known_brand` по всіх ОС
- `test_security.py` — бакети EOL/no_version/unknown, лічильники, unmonitored_vms

**GitHub Actions** (`.github/workflows/ci.yml`): запускається на кожен push до `main`:
- Backend: `ruff check` + `pytest`
- Frontend: `npm ci` + `npm run build`

---

## Домовленості та рішення

> Тут фіксуємо технічні рішення та домовленості між сесіями.

---

### 2026-09-17 — Автентифікація: Windows Auth через IIS, не FastAPI

**Рішення:** Замість власної auth-системи в FastAPI — Windows Auth на рівні IIS + ARR як reverse proxy.

**Чому:** Вся інфраструктура на Windows/AD. IIS вже використовується. Нульовий код в FastAPI — браузер на домен-машині проходить NTLM/Kerberos автоматично.

**Що зроблено:** `web.config` налаштовано, uvicorn прив'язаний до loopback. Залишилось встановити ARR.

---

### 2026-09-17 — Ubuntu без версії ≠ "ОС невідомо"

**Рішення:** Розділили "unknown OS" на два бакети:
- `no_version_items` — бренд розпізнано (Ubuntu, CentOS тощо), але версія відсутня → **"ОС без версії"** (жовта панель)
- `unknown_os_items` — справді невідомо (None, "Other Linux", ESXi) → **"ОС невідомо"** (сіра панель)

**Чому:** Ubuntu без версії — це не відсутність даних про ОС, а відсутність конкретної версії. У нашій базі 365 таких VM.

**Джерело даних:** VMware Tools (`vm.guest.guestFullName`) вже використовується як пріоритет. Якщо Tools встановлено але версія все одно generic — гостьовий тип у vSphere виставлений як "Ubuntu Linux (64-bit)" і Tools просто повертає те ж саме. Єдиний спосіб дізнатись точну версію без Tools — Zabbix `system.uname`.

---

### 2026-09-17 — XLSX-експорт: клієнтська сторона (SheetJS), не backend

**Рішення:** Генерація XLSX у браузері через бібліотеку `xlsx` (SheetJS, вже в `package.json`).

**Чому:** `openpyxl` не в requirements, backend не потрібно ускладнювати. Дані вже завантажені у frontend через React Query.

---

### 2026-09-17 — Синхронізація CMDB ← vCenter: тільки поля що відрізняються

**Рішення:** `POST /api/cmdb-vcenter-sync` оновлює в Jira тільки ті атрибути (vCPU, vRAM, Cluster), де є розбіжність між vCenter і CMDB. PUT-запит містить тільки змінені поля.

**Чому:** Jira Insight `PUT /object/{id}` з частковим набором атрибутів оновлює тільки їх — інші не зачіпаються. vCenter є першоджерелом для hardware-параметрів.

---

### 2026-09-17 — Тести: тільки smoke на критичну логіку

**Рішення:** Не повне покриття, а smoke-тести на `os_lifecycle` (чиста логіка) і security dashboard aggregation (інтеграційний через TestClient з мокнутим DB).

**Чому:** analyzer.py (31KB), sync_service.py (22KB) — регресія при правці одного джерела легко ламає інше. Smoke-тести ловлять найбільш болючі кейси без overhead повного покриття.

---

### 2026-09-17 — CI: тільки lint + build, без deploy

**Рішення:** GitHub Actions запускає ruff + pytest (backend) і npm build (frontend). Deploy — ручний (copy to IIS).

**Чому:** Production IIS на Windows-машині в корпоративній мережі — автодеплой з GitHub потребував би self-hosted runner або VPN. Поки що не пріоритет.

---

### 2026-09-18 — web.config безпеки належить у `frontend/public/`, не в IIS вручну

**Проблема:** Попередній `frontend/public/web.config` в репо не мав ані Windows Auth, ані security headers, ані ARR proxy-правила. Налаштований `C:\inetpub\wwwroot\Statistic-site\web.config` існував лише на сервері — поза git. Кожен `npm run build` + деплой перезаписав би всі security-налаштування голим файлом.

**Рішення:** Повний конфіг (Windows Auth, security headers, ARR rule, SPA fallback) перенесено в `frontend/public/web.config`. Тепер при кожному `npm run build` він потрапляє в `dist/` і деплоїться разом з фронтендом.

**Правило:** Жодних ручних правок `web.config` на сервері без відповідного коміту в репо.

---

### 2026-09-18 — Windows Server License Report: DC vs Standard по ESXi-хостах

**Рішення:** Новий звіт `/license-report` аналізує кожен ESXi-хост і рахує, що дешевше — Datacenter (покриває всі VM) або Standard (покриває 2 VM на ліцензійний набір).

**Формула:**
- DC вартість = `ceil(cores / 2) × dc_price` (за замовчуванням `$769 / 2-core pack`)
- Standard вартість = `ceil(vm_count / 2) × ceil(cores / 2) × std_price` (`$244 / 2-core pack`)
- Якщо Standard < DC → рекомендуємо Standard, показуємо економію.

**Де налаштувати ціни:** `backend/.env` або `config.py` — `dc_license_price_usd` і `standard_license_price_usd`.

**Дані:** `vcenter_vms` (поле `os_full_name` + `runtime_host`) + `vcenter_hosts` (поле `num_cpu_cores`).

---

### 2026-09 — vCenter New VMs: фільтр > 1 тижня

**Рішення:** Сторінка "Нові VM з vCenter" показує тільки VM **старші 1 тижня** (не нові) — тобто ті, що давно існують у vCenter але ще не внесені до CMDB.

**Чому:** Нові VM одразу після створення ще в процесі налаштування. Тиждень — достатній час щоб VM була готова до внесення в CMDB.

**Реалізація:** `config.createDate` читається через pyVmomi PropertyCollector (batch, один SOAP-запит на всі VM).
