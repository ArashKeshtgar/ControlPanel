# Refreshes the PC's development copy of LedgerDashboard from the server.
# The server is production: this only READS it (a COPY_ONLY backup), and
# restores into LedgerDashboard_Dev on this PC, never into LedgerDashboard.
#
#   .\deploy\vps\pull-from-server.ps1
#
# Anything entered in the dev database since the last pull is replaced.
# The PC dashboard (LedgerDashboard/server/.env DB_NAME=LedgerDashboard_Dev)
# reconnects on its own; restart it if a request fails right after.
param(
    [string]$Server = 'deploy@144.217.4.240',
    [string]$Target = 'LedgerDashboard_Dev',
    [string]$SqlServer = '.',
    [switch]$Yes
)
$ErrorActionPreference = 'Stop'
$ssh = 'C:\Windows\System32\OpenSSH\ssh.exe'
$scp = 'C:\Windows\System32\OpenSSH\scp.exe'
$cp = '/srv/portfolio/ControlPanel'

if ($Target -notmatch '_Dev$') { throw "Target must end in _Dev ($Target): production lives on the server." }

& $ssh -o BatchMode=yes $Server 'true'
if ($LASTEXITCODE -ne 0) { throw "Can't reach $Server without a prompt. Is ssh-agent running with your key (ssh-add)?" }
if (-not $Yes -and (Read-Host "Replace $Target on this PC with the server's LedgerDashboard? (yes/no)") -ne 'yes') {
    Write-Host 'Stopped.'; exit 1
}

# --- 1. backup on the server, read through the container -------------------
Write-Host '==> Backing up LedgerDashboard on the server (COPY_ONLY)'
# The SQL goes through stdin, so no quoting through ssh and bash.
$backupSql = "BACKUP DATABASE [LedgerDashboard] TO DISK = N'/var/opt/mssql/backup/ld-pull.bak' WITH INIT, COPY_ONLY, CHECKSUM"
$remote = "cd $cp && " +
    "docker compose exec -T sqlserver bash -c 'f=`$(mktemp); cat > `$f; /opt/mssql-tools18/bin/sqlcmd -C -b -S localhost -U sa " +
    "-P `"`$MSSQL_SA_PASSWORD`" -i `$f; rc=`$?; rm -f `$f; exit `$rc' >/dev/null && " +
    "docker compose exec -T sqlserver cat /var/opt/mssql/backup/ld-pull.bak | gzip > /tmp/ld-pull.bak.gz && " +
    "docker compose exec -T sqlserver rm -f /var/opt/mssql/backup/ld-pull.bak"
$backupSql | & $ssh $Server $remote
if ($LASTEXITCODE -ne 0) { throw 'Backup on the server failed.' }

# --- 2. copy it here --------------------------------------------------------
# Public Documents: the SQL Server service can read it, and so can you.
$dir = [Environment]::GetFolderPath('CommonDocuments')
$gz = Join-Path $dir 'ld-pull.bak.gz'
$bak = Join-Path $dir 'ld-pull.bak'
& $scp "${Server}:/tmp/ld-pull.bak.gz" $gz
if ($LASTEXITCODE -ne 0) { throw 'scp failed.' }
& $ssh $Server 'rm -f /tmp/ld-pull.bak.gz'

$in = [IO.File]::OpenRead($gz)
$out = [IO.File]::Create($bak)
try { $z = [IO.Compression.GZipStream]::new($in, [IO.Compression.CompressionMode]::Decompress); $z.CopyTo($out) }
finally { $out.Dispose(); $in.Dispose() }
Remove-Item $gz

# --- 3. restore as the dev database -----------------------------------------
Write-Host "==> Restoring into $Target"
function Sql([string]$q, [string]$db = 'master') {
    $r = sqlcmd -S $SqlServer -E -b -d $db -h -1 -W -s '|' -Q "SET NOCOUNT ON; $q"
    if ($LASTEXITCODE -ne 0) { throw "SQL failed: $q`n$r" }
    $r
}
$dataDir = (Sql "SELECT CAST(SERVERPROPERTY('InstanceDefaultDataPath') AS nvarchar(260))" | Select-Object -First 1).Trim()
$moves = @()
$n = 0
foreach ($line in (Sql "RESTORE FILELISTONLY FROM DISK = N'$bak'")) {
    $f = $line -split '\|'
    if ($f.Count -lt 3 -or -not $f[0]) { continue }
    $ext = if ($f[2] -eq 'L') { 'ldf' } elseif ($n -gt 0) { 'ndf' } else { 'mdf' }
    $moves += "MOVE N'$($f[0])' TO N'$(Join-Path $dataDir "${Target}_$n.$ext")'"
    $n++
}
if (-not $moves) { throw 'No files listed in the backup.' }
Sql ("IF DB_ID(N'$Target') IS NOT NULL ALTER DATABASE [$Target] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; " +
     "RESTORE DATABASE [$Target] FROM DISK = N'$bak' WITH REPLACE, RECOVERY, " + ($moves -join ', ') + "; " +
     "ALTER DATABASE [$Target] SET MULTI_USER;") | Out-Null
Remove-Item $bak

# The server's logins have other SIDs than this PC's: re-attach the users
# to the local logins of the same name (passwords stay the PC's own).
foreach ($u in 'ledger_svc', 'ledger_reader') {
    Sql "IF USER_ID(N'$u') IS NOT NULL AND SUSER_ID(N'$u') IS NOT NULL ALTER USER [$u] WITH LOGIN = [$u];" $Target | Out-Null
}

$apps = (Sql 'SELECT COUNT(*) FROM dbo.Applications' $Target | Select-Object -First 1).Trim()
Write-Host "Done. $Target now matches the server ($apps applications)." -ForegroundColor Green
