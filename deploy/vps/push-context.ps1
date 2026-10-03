# Sends the context engine's export (context.json) to the server, where Caddy
# serves it only on the private ctx.<domain> site (basic auth). The file never
# goes into git or a container image. Run on the PC:
#
#   .\deploy\vps\push-context.ps1            # send the current out\context.json
#   .\deploy\vps\push-context.ps1 -Export    # run `python ctx.py export` first
#
# The upload lands as a temp file and is renamed into place, so the phone
# never reads a half-written file. release.ps1 calls this too.
param(
    [string]$Server = 'deploy@144.217.4.240',
    [string]$Domain = 'arashkeshtgar.ca',
    [string]$Engine = 'C:\Users\akesh\Downloads\SmartLedgerAI-JobPrep\Context\engine',
    [switch]$Export
)
$ErrorActionPreference = 'Stop'
$ssh = 'C:\Windows\System32\OpenSSH\ssh.exe'
$scp = 'C:\Windows\System32\OpenSSH\scp.exe'
$dir = '/srv/portfolio/context'
$file = Join-Path $Engine 'out\context.json'

if ($Export) {
    Push-Location $Engine
    try { python ctx.py export; if ($LASTEXITCODE -ne 0) { throw 'ctx.py export failed.' } }
    finally { Pop-Location }
}
if (-not (Test-Path $file)) { throw "No $file - run with -Export." }
# A broken export must not replace a good copy on the phone.
$data = Get-Content $file -Raw -Encoding UTF8 | ConvertFrom-Json
if (-not $data.generated -or -not $data.packs) { throw "$file doesn't look like a context export." }

& $ssh $Server "mkdir -p $dir"
if ($LASTEXITCODE -ne 0) { throw 'ssh to the server failed.' }
& $scp -q $file "${Server}:$dir/context.json.tmp"
if ($LASTEXITCODE -ne 0) { throw 'scp of context.json failed.' }
& $ssh $Server "chmod 644 $dir/context.json.tmp && mv $dir/context.json.tmp $dir/context.json"
if ($LASTEXITCODE -ne 0) { throw 'Moving context.json into place failed.' }

Write-Host "Context $($data.generated) -> https://ctx.$Domain" -ForegroundColor Green
