# Backs up LedgerDashboard and LabFlow from the SQL Server on this Windows
# machine, for restore-db.sh on the VPS. Run in PowerShell (no admin needed;
# Windows authentication to the local SQL Server):
#
#   .\deploy\vps\export-dbs.ps1
#   scp .\deploy\vps\export\*.bak deploy@<server>:/srv/backups/import/
#
# COPY_ONLY: doesn't disturb any backup chain on this machine.
param(
    [string]$Server = '.',
    [string[]]$Databases = @('LedgerDashboard', 'LabFlow'),
    [string]$OutDir = (Join-Path $PSScriptRoot 'export')
)
$ErrorActionPreference = 'Stop'

New-Item -ItemType Directory -Force $OutDir | Out-Null
# The SQL Server service writes the file, and its own Backup folder isn't
# readable without admin rights; Public Documents is writable by the
# service and readable by you. The copy there is removed afterwards.
$backupDir = [Environment]::GetFolderPath('CommonDocuments')

foreach ($db in $Databases) {
    $file = Join-Path $backupDir "$db-vps.bak"
    Write-Host "Backing up $db -> $file"
    sqlcmd -S $Server -E -b -Q "BACKUP DATABASE [$db] TO DISK = N'$file' WITH INIT, COPY_ONLY, CHECKSUM"
    if ($LASTEXITCODE -ne 0) { throw "Backup of $db failed." }
    Copy-Item $file (Join-Path $OutDir "$db.bak") -Force
    Remove-Item $file
}

Get-ChildItem $OutDir -Filter *.bak | Format-Table Name, @{ n = 'MB'; e = { [math]::Round($_.Length / 1MB, 1) } }
Write-Host "Next: scp `"$OutDir\*.bak`" deploy@<server>:/srv/backups/import/"
