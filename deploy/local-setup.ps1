# Gets this Windows machine ready for the apps layer (compose.apps.yml) after
# a release that added apps: one command instead of filling .env and running
# the login scripts by hand. Safe to run again; it never changes a value
# that's already in .env and never touches a database that already exists.
#
#   .\deploy\local-setup.ps1
#   .\deploy\local-setup.ps1 -ProjectsDir D:\E\Projects -Server .
#
# What it does:
#   1. .env: adds FINANCE_DIR, PHARMAFLOW_DIR, DEPLOY_DIR and the new SQL
#      passwords if they're missing (passwords generated here, letters and
#      digits only, like make-env.sh on the server). The repo folders
#      default to <ProjectsDir>\FinancePowerApp and <ProjectsDir>\Drugstore,
#      and are cloned from GitHub if they aren't there.
#   2. Databases: FinancePowerApp and PharmaFlow are created with each repo's
#      own database\deploy.ps1 when they don't exist yet. An existing one is
#      left alone (FinancePowerApp's deploy.ps1 upgrades the Power App's
#      database in place: run it yourself, after a backup, when you want that).
#   3. Logins: finance_svc, finance_reader, pharmaflow_svc and, if LabFlow's
#      database exists, labflow_reader, with the passwords from .env.
# Windows authentication to the local SQL Server; no admin rights needed
# beyond what creating logins on it needs.
param(
    [string]$Server = '.',
    [string]$ProjectsDir = (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent)
)
$ErrorActionPreference = 'Stop'

$root = Split-Path $PSScriptRoot -Parent
$envFile = Join-Path $root '.env'
if (-not (Test-Path $envFile)) { throw "No $envFile yet: copy .env.example to .env and fill it in first." }
if (-not (Get-Command sqlcmd -ErrorAction SilentlyContinue)) { throw 'sqlcmd is not on the PATH.' }

function Step([string]$t) { Write-Host "`n==> $t" -ForegroundColor Cyan }

# KEY=value lines of .env, as a hashtable (surrounding quotes removed).
function Read-Env {
    $values = @{}
    foreach ($line in Get-Content $envFile) {
        if ($line -match '^\s*([A-Z_][A-Z0-9_]*)=(.*)$') {
            $values[$Matches[1]] = $Matches[2].Trim().Trim('"').Trim("'")
        }
    }
    $values
}

function New-SqlPassword {
    $chars = [char[]]'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
    $bytes = New-Object byte[] 28
    [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    (-join ($bytes | ForEach-Object { $chars[$_ % $chars.Length] })) + '-Aa1'
}

# Appends KEY=value without a BOM (Compose would read a BOM as part of the
# first key), after a newline if the file doesn't end with one.
$utf8 = New-Object Text.UTF8Encoding($false)
function Add-EnvValue([string]$key, [string]$value) {
    $text = [IO.File]::ReadAllText($envFile)
    $prefix = if ($text.Length -gt 0 -and -not $text.EndsWith("`n")) { "`r`n" } else { '' }
    [IO.File]::AppendAllText($envFile, "$prefix$key=$value`r`n", $utf8)
    Write-Host "  added $key"
}

function Test-Database([string]$name) {
    $out = & sqlcmd -S $Server -E -C -b -h -1 -W -Q "SET NOCOUNT ON; SELECT CASE WHEN DB_ID(N'$name') IS NULL THEN 0 ELSE 1 END"
    if ($LASTEXITCODE -ne 0) { throw "Can't reach SQL Server '$Server' with Windows authentication." }
    ($out | Where-Object { $_ } | Select-Object -First 1).Trim() -eq '1'
}

function Invoke-SqlFile([string]$file, [string[]]$vars) {
    & sqlcmd -S $Server -E -C -b -i $file -v @vars | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "sqlcmd failed: $file" }
}

# ------------------------------------------------------------------ .env --
Step '.env'
$envValues = Read-Env
$repos = [ordered]@{
    FINANCE_DIR    = @{ Folder = 'FinancePowerApp'; Url = 'https://github.com/ArashKeshtgar/FinancePowerApp.git' }
    PHARMAFLOW_DIR = @{ Folder = 'Drugstore'; Url = 'https://github.com/ArashKeshtgar/Drugstore.git' }
}
foreach ($key in $repos.Keys) {
    if ($envValues[$key]) { continue }
    $dir = Join-Path $ProjectsDir $repos[$key].Folder
    if (-not (Test-Path $dir)) {
        Write-Host "  cloning $($repos[$key].Url) -> $dir"
        & git clone -q $repos[$key].Url $dir
        if ($LASTEXITCODE -ne 0) { throw "git clone failed: $($repos[$key].Url)" }
    }
    Add-EnvValue $key $dir
}
if (-not $envValues['DEPLOY_DIR']) { Add-EnvValue 'DEPLOY_DIR' (Join-Path $root 'deploy') }
foreach ($key in 'FINANCE_DB_PASSWORD', 'FINANCE_READER_PASSWORD', 'PHARMAFLOW_DB_PASSWORD', 'LABFLOW_READER_PASSWORD') {
    if (-not $envValues[$key]) { Add-EnvValue $key (New-SqlPassword) }
}
$envValues = Read-Env

# ------------------------------------------------------------- databases --
Step 'Databases'
foreach ($db in @(
        @{ Name = 'FinancePowerApp'; Dir = $envValues['FINANCE_DIR'] },
        @{ Name = 'PharmaFlow'; Dir = $envValues['PHARMAFLOW_DIR'] })) {
    if (Test-Database $db.Name) {
        Write-Host "  $($db.Name) exists, left as it is"
        continue
    }
    $deploy = Join-Path $db.Dir 'database\deploy.ps1'
    if (-not (Test-Path $deploy)) { throw "No $deploy" }
    Write-Host "  creating $($db.Name) with demo data"
    & $deploy -Server $Server -Database $db.Name
}

# ---------------------------------------------------------------- logins --
Step 'Logins'
$deployDir = Join-Path $root 'deploy'
Invoke-SqlFile (Join-Path $deployDir 'finance\sql-login.sql') @(
    "FINANCE_DB_PASSWORD=$($envValues['FINANCE_DB_PASSWORD'])",
    "FINANCE_READER_PASSWORD=$($envValues['FINANCE_READER_PASSWORD'])")
Write-Host '  finance_svc, finance_reader'
Invoke-SqlFile (Join-Path $deployDir 'pharmaflow\sql-login.sql') @("PHARMAFLOW_DB_PASSWORD=$($envValues['PHARMAFLOW_DB_PASSWORD'])")
Write-Host '  pharmaflow_svc'
if (Test-Database 'LabFlow') {
    Invoke-SqlFile (Join-Path $deployDir 'labflow\reader-login.sql') @("LABFLOW_READER_PASSWORD=$($envValues['LABFLOW_READER_PASSWORD'])")
    Write-Host '  labflow_reader'
} else {
    Write-Host '  labflow_reader skipped: no LabFlow database on this server'
}

Write-Host "`nDone. Start everything with:" -ForegroundColor Green
Write-Host '  docker compose -f docker-compose.yml -f compose.apps.yml up -d --build'
