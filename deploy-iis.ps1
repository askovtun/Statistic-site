# deploy-iis.ps1 — Деплой Statistic-site на IIS
#
# Параметри:
#   -SitePath  Фізичний шлях IIS сайту  (default: C:\inetpub\wwwroot\statistic-site)
#   -Port      Порт backend uvicorn     (default: 8000)
#
param(
    [string]$SitePath = "C:\inetpub\wwwroot\statistic-site",
    [int]   $Port     = 8000
)

$ErrorActionPreference = "Stop"
$Root = Split-Path $MyInvocation.MyCommand.Path

Write-Host "=== Statistic-site IIS Deploy ===" -ForegroundColor Cyan

# ── 1. Збираємо фронтенд ──────────────────────────────────────────────────────
Write-Host "`n[1/3] Збираємо React frontend..." -ForegroundColor Yellow
Set-Location "$Root\frontend"
node "$Root\frontend\node_modules\.bin\vite" build
if ($LASTEXITCODE -ne 0) { throw "Vite build failed" }

# ── 2. Копіюємо dist/ на IIS ──────────────────────────────────────────────────
Write-Host "`n[2/3] Копіюємо dist/ → $SitePath ..." -ForegroundColor Yellow
if (-not (Test-Path $SitePath)) {
    New-Item -ItemType Directory -Path $SitePath | Out-Null
}
Copy-Item -Path "$Root\frontend\dist\*" -Destination $SitePath -Recurse -Force
Write-Host "  Файлів скопійовано: $(Get-ChildItem $SitePath -Recurse -File | Measure-Object | Select -Exp Count)"

# ── 3. Копіюємо backend ───────────────────────────────────────────────────────
Write-Host "`n[3/3] Копіюємо backend → $SitePath\backend ..." -ForegroundColor Yellow
$BackendDest = "$SitePath\backend"
if (-not (Test-Path $BackendDest)) {
    New-Item -ItemType Directory -Path $BackendDest | Out-Null
}
Copy-Item -Path "$Root\backend\app"          -Destination $BackendDest -Recurse -Force
Copy-Item -Path "$Root\backend\requirements.txt" -Destination $BackendDest -Force
if (Test-Path "$Root\backend\.env") {
    Copy-Item -Path "$Root\backend\.env" -Destination $BackendDest -Force
    Write-Host "  .env скопійовано"
} else {
    Write-Warning "  backend\.env не знайдено! Скопіюйте .env.example → .env та заповніть credentials."
}

# ── Підсумок ──────────────────────────────────────────────────────────────────
Write-Host "`n=== Готово! ===" -ForegroundColor Green
Write-Host @"

Наступні кроки:
  1. Переконайтеся що IIS сайт вказує на: $SitePath
  2. Запустіть backend (окремо або як сервіс):

     cd $SitePath\backend
     python -m uvicorn app.main:app --host 127.0.0.1 --port $Port

  3. Переконайтесь що в IIS встановлено ARR + URL Rewrite:
     - URL Rewrite: https://www.iis.net/downloads/microsoft/url-rewrite
     - ARR:         https://www.iis.net/downloads/microsoft/application-request-routing

  4. Перевірте що у IIS Manager для сайту увімкнено проксі:
     Application Request Routing Cache → Server Proxy Settings → Enable proxy: ✓
"@
