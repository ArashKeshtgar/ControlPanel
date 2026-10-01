# Makes the server match this PC: LedgerDashboard's database and the
# JobSearch folder are copied PC -> server, replacing what the server has.
# Run in PowerShell from the ControlPanel folder (Windows ssh.exe, so the
# ssh-agent key works):
#
#   .\deploy\vps\sync-to-server.ps1
#   .\deploy\vps\sync-to-server.ps1 -SkipJobSearch     # database only
#
# Before anything is replaced, backup.sh takes a fresh backup of every
# database on the server and the server's JobSearch is kept as a .tgz in
# /srv/backups, so a wrong-direction sync can be undone.
#
# This is for the switch-over only: once the server is the production copy
# of LedgerDashboard, running this again would throw away server-side work.
param(
    [string]$Server = 'deploy@144.217.4.240',
    [string]$JobSearch = 'C:\Users\akesh\Downloads\SmartLedgerAI-JobPrep\JobSearch',
    [switch]$SkipDatabase,
    [switch]$SkipJobSearch,
    [switch]$Yes
)
$ErrorActionPreference = 'Stop'
$ssh = 'C:\Windows\System32\OpenSSH\ssh.exe'
$scp = 'C:\Windows\System32\OpenSSH\scp.exe'
$tar = 'C:\Windows\System32\tar.exe'
$cp = '/srv/portfolio/ControlPanel'

function Remote([string]$cmd) {
    & $ssh $Server $cmd
    if ($LASTEXITCODE -ne 0) { throw "On the server, failed: $cmd" }
}

# Row count per table, "schema.table|rows", for comparing both sides.
$countSql = "SET NOCOUNT ON; SELECT s.name + '.' + t.name + '|' + CAST(SUM(p.rows) AS varchar(20)) " +
            "FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id " +
            "JOIN sys.partitions p ON p.object_id = t.object_id AND p.index_id IN (0, 1) " +
            "GROUP BY s.name, t.name ORDER BY 1"

function LocalCounts {
    sqlcmd -S . -E -d LedgerDashboard -b -h -1 -W -Q $countSql | Where-Object { $_ -match '\|' }
}
function ServerCounts {
    # The query goes through stdin, so no quoting through ssh and bash.
    $countSql | & $ssh $Server ("cd $cp && docker compose exec -T sqlserver bash -c " +
        "'f=`$(mktemp); cat > `$f; /opt/mssql-tools18/bin/sqlcmd -C -b -S localhost -U sa -P " +
        "`"`$MSSQL_SA_PASSWORD`" -d LedgerDashboard -h -1 -W -i `$f; rc=`$?; rm -f `$f; exit `$rc'") |
        Where-Object { $_ -match '\|' }
}

# --- preflight -------------------------------------------------------------
& $ssh -o BatchMode=yes $Server 'true'
if ($LASTEXITCODE -ne 0) {
    throw "Can't reach $Server without a prompt. Is ssh-agent running with your key (ssh-add)?"
}
if (-not $SkipJobSearch -and -not (Test-Path $JobSearch)) { throw "No JobSearch folder at $JobSearch" }

Write-Host "This REPLACES on $Server :" -ForegroundColor Yellow
if (-not $SkipDatabase)  { Write-Host '  - the LedgerDashboard database' }
if (-not $SkipJobSearch) { Write-Host '  - /srv/portfolio/JobSearch' }
if (-not $Yes -and (Read-Host 'Continue? (yes/no)') -ne 'yes') { Write-Host 'Stopped.'; exit 1 }

# --- 1. safety backup on the server ----------------------------------------
Write-Host '==> Backing up the server first (backup.sh)'
Remote "$cp/deploy/vps/backup.sh"

# --- 2. JobSearch ----------------------------------------------------------
if (-not $SkipJobSearch) {
    Write-Host "==> JobSearch  $JobSearch -> /srv/portfolio/JobSearch"
    $stamp = Get-Date -Format 'yyyyMMdd-HHmm'
    Remote "tar -czf /srv/backups/jobsearch-before-sync-$stamp.tgz -C /srv/portfolio JobSearch && rm -rf /srv/portfolio/JobSearch.new && mkdir /srv/portfolio/JobSearch.new"

    # tar over ssh: a new folder, then swapped in, so files deleted on the PC
    # are gone on the server too and a broken transfer changes nothing.
    $parent = Split-Path $JobSearch -Parent
    $name = Split-Path $JobSearch -Leaf
    $archive = Join-Path $env:TEMP "jobsearch-sync-$stamp.tgz"
    & $tar -czf $archive -C $parent $name
    if ($LASTEXITCODE -ne 0) { throw 'tar failed on the PC.' }
    & $scp $archive "${Server}:/srv/portfolio/JobSearch.new/upload.tgz"
    if ($LASTEXITCODE -ne 0) { throw 'scp of JobSearch failed.' }
    Remove-Item $archive

    Remote ("cd /srv/portfolio/JobSearch.new && tar -xzf upload.tgz --strip-components=1 && rm upload.tgz && " +
            "cd /srv/portfolio && rm -rf JobSearch.old && mv JobSearch JobSearch.old && mv JobSearch.new JobSearch && rm -rf JobSearch.old")
    # The container's bind mount still points at the old folder until restarted.
    Remote "cd $cp && docker compose restart ledgerdashboard"
    Write-Host '    JobSearch synced'
}

# --- 3. LedgerDashboard database -------------------------------------------
if (-not $SkipDatabase) {
    Write-Host '==> LedgerDashboard database'
    & (Join-Path $PSScriptRoot 'export-dbs.ps1') -Databases LedgerDashboard
    $bak = Join-Path $PSScriptRoot 'export\LedgerDashboard.bak'
    & $scp $bak "${Server}:/srv/backups/import/LedgerDashboard.bak"
    if ($LASTEXITCODE -ne 0) { throw 'scp of the backup failed.' }
    # restore-db.sh also recreates the logins and restarts ledgerdashboard,
    # ledgerdash-adapter and anything else that was connected.
    Remote "$cp/deploy/vps/restore-db.sh /srv/backups/import/LedgerDashboard.bak && rm -f /srv/backups/import/LedgerDashboard.bak"

    Write-Host '==> Comparing row counts (PC vs server)'
    $local = LocalCounts
    $remote = ServerCounts
    $diff = Compare-Object $local $remote
    if ($diff) {
        $diff | Format-Table @{ n = 'table|rows'; e = { $_.InputObject } },
                             @{ n = 'only on'; e = { if ($_.SideIndicator -eq '<=') { 'PC' } else { 'server' } } }
        throw 'Row counts differ - check before switching over.'
    }
    Write-Host "    $($local.Count) tables, identical row counts"
}

Write-Host '==> Health'
Remote "cd $cp && docker compose ps --format '{{.Service}}: {{.Status}}' | grep -i ledger"
Write-Host 'Done. Server now matches this PC.' -ForegroundColor Green
