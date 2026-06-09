# install-service.ps1 — Реєструє FastAPI backend як Windows Service
# Запускати від імені Адміністратора!
#
# Використовує вбудований sc.exe + wrapper через pythonw.exe
# Якщо є NSSM — використовує його (надійніший варіант)
#
param(
    [string]$ServiceName = "StatisticSiteBackend",
    [string]$BackendPath  = $PSScriptRoot,
    [int]   $Port         = 8000
)

$ErrorActionPreference = "Stop"
$Python = (Get-Command python).Source

# Перевіряємо чи є .env
if (-not (Test-Path "$BackendPath\.env")) {
    Write-Error ".env не знайдено в $BackendPath. Скопіюйте .env.example → .env та заповніть."
    exit 1
}

# ── Варіант 1: NSSM (якщо встановлений) ──────────────────────────────────────
$nssm = Get-Command nssm -ErrorAction SilentlyContinue
if ($nssm) {
    Write-Host "Встановлюємо сервіс через NSSM..." -ForegroundColor Cyan
    & nssm install $ServiceName $Python "-m uvicorn app.main:app --host 127.0.0.1 --port $Port"
    & nssm set $ServiceName AppDirectory $BackendPath
    & nssm set $ServiceName DisplayName "Statistic-site Backend (FastAPI)"
    & nssm set $ServiceName Description "FastAPI backend for infrastructure analytics dashboard"
    & nssm set $ServiceName Start SERVICE_AUTO_START
    & nssm set $ServiceName AppStdout "$BackendPath\logs\uvicorn.log"
    & nssm set $ServiceName AppStderr "$BackendPath\logs\uvicorn-error.log"

    New-Item -ItemType Directory -Force -Path "$BackendPath\logs" | Out-Null
    & nssm start $ServiceName
    Write-Host "Сервіс '$ServiceName' запущено!" -ForegroundColor Green

# ── Варіант 2: sc.exe + wrapper .bat ──────────────────────────────────────────
} else {
    Write-Host "NSSM не знайдено. Використовуємо wrapper bat + sc.exe..." -ForegroundColor Yellow

    # Створюємо bat-wrapper
    $bat = "$BackendPath\start-backend.bat"
    @"
@echo off
cd /d "$BackendPath"
"$Python" -m uvicorn app.main:app --host 127.0.0.1 --port $Port >> "$BackendPath\logs\uvicorn.log" 2>&1
"@ | Out-File -FilePath $bat -Encoding ascii

    New-Item -ItemType Directory -Force -Path "$BackendPath\logs" | Out-Null

    # Видаляємо старий сервіс якщо є
    $existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    if ($existing) {
        Write-Host "Видаляємо старий сервіс..." -ForegroundColor Yellow
        Stop-Service $ServiceName -ErrorAction SilentlyContinue
        & sc.exe delete $ServiceName
        Start-Sleep 2
    }

    # Реєструємо через Task Scheduler (надійніше ніж sc.exe для Python)
    $action  = New-ScheduledTaskAction -Execute $Python `
                 -Argument "-m uvicorn app.main:app --host 127.0.0.1 --port $Port" `
                 -WorkingDirectory $BackendPath
    $trigger = New-ScheduledTaskTrigger -AtStartup
    $settings = New-ScheduledTaskSettingsSet -RestartOnIdle -RunOnlyIfNetworkAvailable:$false
    $principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest

    Register-ScheduledTask -TaskName $ServiceName `
        -Action $action -Trigger $trigger `
        -Settings $settings -Principal $principal `
        -Description "Statistic-site FastAPI backend" `
        -Force | Out-Null

    Start-ScheduledTask -TaskName $ServiceName
    Write-Host "Заплановане завдання '$ServiceName' зареєстровано і запущено!" -ForegroundColor Green
    Write-Host "Буде автоматично стартувати при увімкненні системи."
}

Write-Host "`nПеревірка: http://localhost:$Port/api/health" -ForegroundColor Cyan
