# One command to ship everything from this PC to the server: code (every
# app's front end and back end), database schema, and the JobSearch engine
# files. Production DATA is never sent: it lives only on the server.
#
#   .\deploy\vps\release.ps1              # shows the plan, asks, then ships
#   .\deploy\vps\release.ps1 -DryRun      # only the plan
#   .\deploy\vps\release.ps1 -PullTruthBank   # bring the dashboard's truth-bank edits to this PC
#
# Steps, in order — any failure stops the release before the next one:
#   1. checks   every repo is on its main branch, nothing uncommitted, not behind GitHub;
#               and the server's truth bank has no commit or edit this PC lacks
#               (step 4 would overwrite it)
#   2. tests    LedgerDashboard and Control Panel core-api unit tests
#   3. push     commits to GitHub, plus a release-<date-time> tag in every repo
#               (the tag says exactly which version is on the server)
#   4. files    JobSearch engine files (facts, templates, scripts) -> server,
#               after a backup; applications/ and daily/ are left alone
#   5. deploy   deploy.sh on the server: pull, rebuild containers, health checks
#   6. migrate  migrate.sh: apply database schema changes, then the context
#               engine export -> ctx.<domain> (push-context.ps1; -SkipContext)
#   7. smoke    every public site answers as expected
param(
    [string]$Server = 'deploy@144.217.4.240',
    [string]$Domain = 'arashkeshtgar.ca',
    [string]$JobSearch = 'C:\Users\akesh\Downloads\SmartLedgerAI-JobPrep\JobSearch',
    # Release only some repos, e.g. -Only LedgerDashboard,ControlPanel
    [string[]]$Only,
    [switch]$SkipTests,
    [switch]$SkipJobSearch,
    [switch]$SkipContext,
    [switch]$DryRun,
    [switch]$Yes,
    # Only pull the server's truth-bank commits (dashboard edits) to this PC.
    [switch]$PullTruthBank
)
$ErrorActionPreference = 'Stop'
$ssh = 'C:\Windows\System32\OpenSSH\ssh.exe'
$scp = 'C:\Windows\System32\OpenSSH\scp.exe'
$cp = '/srv/portfolio/ControlPanel'
$stamp = Get-Date -Format 'yyyyMMdd-HHmm'
$tag = "release-$stamp"

# The repos the server builds. Tests: folder (inside the repo) -> command.
$repos = [ordered]@{
    ControlPanel           = @{ Path = 'D:\E\Projects\ControlPanel'; Tests = @{ 'services\core-api' = 'npm test --silent' } }
    LedgerDashboard        = @{ Path = 'C:\Users\akesh\Downloads\SmartLedgerAI-JobPrep\LedgerDashboard'; Tests = @{ 'server' = 'npm test --silent' } }
    Rebiomed               = @{ Path = 'D:\E\Projects\mern-animation-project'; Tests = @{} }
    LabFlow                = @{ Path = 'D:\E\Projects\LabFlow'; Tests = @{} }
    LanguageLessonDesigner = @{ Path = 'D:\E\Projects\LanguageLessonDesigner'; Tests = @{} }
}

if ($Only) {
    foreach ($n in @($repos.Keys)) { if ($Only -notcontains $n) { $repos.Remove($n) } }
    if (-not $repos.Count) { throw "-Only matched no repo. Known: ControlPanel, LedgerDashboard, Rebiomed, LabFlow, LanguageLessonDesigner" }
}

function Step([string]$t) { Write-Host "`n==> $t" -ForegroundColor Cyan }
function Remote([string]$cmd) {
    & $ssh $Server $cmd
    if ($LASTEXITCODE -ne 0) { throw "On the server, failed: $cmd" }
}
function Git([string]$repo) {
    $out = & git.exe -C $repo @args 2>&1
    if ($LASTEXITCODE -ne 0) { throw "git $args in $repo failed:`n$out" }
    $out
}

$engine = Join-Path $JobSearch 'engine'
$serverEngine = '/srv/portfolio/JobSearch/engine'

# -PullTruthBank: fast-forward this PC's truth bank (engine git) to the
# server's, so edits made in the live dashboard aren't lost by the next
# release. Only pulls; ships nothing.
if ($PullTruthBank) {
    Step 'Pull the truth bank from the server'
    $dirty = Git $engine status --porcelain --untracked-files=no
    if ($dirty) { throw "Commit or discard these truth-bank changes on this PC first:`n$($dirty -join "`n")" }
    $before = (Git $engine rev-parse --short HEAD).Trim()
    # git reports progress on stderr, which Windows PowerShell turns into a
    # terminating error under 'Stop' — the exit code decides instead.
    $ErrorActionPreference = 'Continue'
    $out = & git.exe -C $engine -c 'core.sshCommand=C:/Windows/System32/OpenSSH/ssh.exe -o BatchMode=yes' `
        pull --ff-only "${Server}:$serverEngine" master 2>&1
    $code = $LASTEXITCODE
    $ErrorActionPreference = 'Stop'
    if ($code -ne 0) {
        throw "Couldn't fast-forward: this PC and the server both have new truth-bank commits. Merge them by hand in $engine.`n$out"
    }
    Write-Host "  $before -> $((Git $engine rev-parse --short HEAD).Trim())"
    Git $engine log --oneline "$before..HEAD" | ForEach-Object { Write-Host "      $_" -ForegroundColor DarkGray }
    exit 0
}

# --- 1. checks -------------------------------------------------------------
Step '1/7 Checks'
& $ssh -o BatchMode=yes $Server 'true'
if ($LASTEXITCODE -ne 0) { throw "Can't reach $Server without a prompt. Is ssh-agent running with your key (ssh-add)?" }

$problems = @()
foreach ($name in $repos.Keys) {
    $r = $repos[$name]; $p = $r.Path
    Git $p fetch --quiet origin | Out-Null
    # The branch GitHub calls default is the one the server pulls.
    $default = ((Git $p ls-remote --symref origin HEAD | Select-String '^ref: refs/heads/(\S+)').Matches[0].Groups[1].Value)
    $branch = (Git $p branch --show-current).Trim()
    $dirty = Git $p status --porcelain --untracked-files=no
    $behind = [int](Git $p rev-list --count "HEAD..origin/$default")
    $ahead = @(Git $p log --oneline "origin/$default..HEAD")
    $r.Default = $default; $r.Ahead = $ahead

    $state = if ($ahead.Count) { "$($ahead.Count) new commit(s) to ship" } else { 'up to date' }
    Write-Host ("  {0,-23} {1,-8} {2}" -f $name, $branch, $state)
    $ahead | ForEach-Object { Write-Host "      $_" -ForegroundColor DarkGray }
    if ($branch -ne $default) { $problems += "$name is on '$branch', not '$default' (the branch the server builds)." }
    if ($dirty) { $problems += "$name has uncommitted changes:`n$($dirty -join "`n")" }
    if ($behind -gt 0) { $problems += "$name is $behind commit(s) behind GitHub: git pull first." }
}

# The truth bank is edited in two places: on this PC, and in the live
# dashboard, which commits every save to the server's engine/.git. Step 4
# sends this PC's engine files, .git included, over the server's copy — so
# a commit or an uncommitted edit that exists only on the server would be
# silently replaced. Refuse instead; -PullTruthBank brings them here first.
if (-not $SkipJobSearch) {
    $remote = @(& $ssh -o BatchMode=yes $Server "cd $serverEngine && git log --all --format='%H %ad %s' --date=short && echo '--status--' && git status --porcelain --untracked-files=no")
    $split = [array]::IndexOf($remote, '--status--')
    if ($LASTEXITCODE -ne 0 -or $split -lt 0) {
        $problems += "Couldn't read the truth bank's git history on the server ($serverEngine). Use -SkipJobSearch to ship code only."
    }
    else {
        $serverLog = @(); $serverDirty = @()
        for ($i = 0; $i -lt $remote.Count; $i++) {
            if ($i -lt $split) { $serverLog += $remote[$i] } elseif ($i -gt $split -and $remote[$i]) { $serverDirty += $remote[$i] }
        }
        $pcCommits = @(Git $engine rev-list --all)
        $onlyOnServer = @($serverLog | Where-Object { $pcCommits -notcontains ($_ -split ' ')[0] })
        $pcDirty = @(Git $engine status --porcelain --untracked-files=no)

        $state = if ($onlyOnServer.Count -or $serverDirty.Count) { 'server has changes this PC lacks' } else { 'server has nothing this PC lacks' }
        Write-Host ("  {0,-23} {1,-8} {2}" -f 'Truth bank (engine)', '', $state)
        if ($onlyOnServer.Count) {
            $problems += "The server's truth bank has $($onlyOnServer.Count) commit(s) this PC doesn't (dashboard edits). Sending would overwrite them:`n" +
                (($onlyOnServer | Select-Object -First 10 | ForEach-Object { '      ' + $_.Substring(0, 8) + $_.Substring(40) }) -join "`n") +
                "`n    Bring them here first:  .\deploy\vps\release.ps1 -PullTruthBank   (or ship code only with -SkipJobSearch)"
        }
        if ($serverDirty.Count) {
            $problems += "The server's truth bank has uncommitted edits (open the dashboard's Health page and commit them, then -PullTruthBank):`n$($serverDirty -join "`n")"
        }
        if ($pcDirty.Count) {
            $problems += "This PC's truth bank has uncommitted edits; commit them in $engine first:`n$($pcDirty -join "`n")"
        }
    }
}
if ($problems) { $problems | ForEach-Object { Write-Host "  ✗ $_" -ForegroundColor Red }; throw 'Fix the above, then release again.' }

if ($DryRun) { Write-Host "`nDry run: nothing shipped. Would tag $tag." -ForegroundColor Yellow; exit 0 }
if (-not $Yes -and (Read-Host "`nShip all of this to $Server as $tag? (yes/no)") -ne 'yes') { Write-Host 'Stopped.'; exit 1 }

# --- 2. tests --------------------------------------------------------------
Step '2/7 Tests'
if ($SkipTests) { Write-Host '  skipped (-SkipTests)' -ForegroundColor Yellow }
else {
    foreach ($name in $repos.Keys) {
        foreach ($t in $repos[$name].Tests.GetEnumerator()) {
            Write-Host "  $name/$($t.Key): $($t.Value)"
            Push-Location (Join-Path $repos[$name].Path $t.Key)
            try { cmd /c $t.Value; if ($LASTEXITCODE -ne 0) { throw "Tests failed in $name/$($t.Key)." } }
            finally { Pop-Location }
        }
    }
}

# --- 3. push + tag ---------------------------------------------------------
Step "3/7 Push to GitHub and tag $tag"
foreach ($name in $repos.Keys) {
    $r = $repos[$name]
    if ($r.Ahead.Count) { Git $r.Path push --quiet origin "HEAD:$($r.Default)" | Out-Null }
    Git $r.Path tag -a $tag -m "Released to $Server" | Out-Null
    Git $r.Path push --quiet origin $tag | Out-Null
    Write-Host "  $name ok"
}

# --- 4. JobSearch engine files ---------------------------------------------
Step '4/7 JobSearch files'
if ($SkipJobSearch) { Write-Host '  skipped (-SkipJobSearch)' -ForegroundColor Yellow }
else {
    # The server owns engine/applications (packages it built) and this PC
    # owns engine/daily (the nightly reports): neither is sent.
    Remote "tar -czf /srv/backups/jobsearch-before-$tag.tgz -C /srv/portfolio JobSearch"
    $archive = Join-Path $env:TEMP "jobsearch-$tag.tgz"
    & C:\Windows\System32\tar.exe -czf $archive --exclude 'JobSearch/engine/applications' --exclude 'JobSearch/engine/daily' `
        -C (Split-Path $JobSearch -Parent) (Split-Path $JobSearch -Leaf)
    if ($LASTEXITCODE -ne 0) { throw 'tar failed on the PC.' }
    & $scp -q $archive "${Server}:/tmp/jobsearch-$tag.tgz"
    if ($LASTEXITCODE -ne 0) { throw 'scp of JobSearch failed.' }
    Remove-Item $archive
    # engine/.git directories the dashboard container commits into belong to
    # its uid, not deploy, so tar can't reset their times: leave existing
    # directories' metadata alone. Windows tar's SCHILY.fflags headers are noise.
    Remote "tar -xzf /tmp/jobsearch-$tag.tgz -C /srv/portfolio --no-overwrite-dir --warning=no-unknown-keyword && rm /tmp/jobsearch-$tag.tgz"
    Write-Host "  sent (server copy backed up as /srv/backups/jobsearch-before-$tag.tgz)"
}

# --- 5. deploy -------------------------------------------------------------
Step '5/7 Deploy (pull, rebuild, health checks)'
Remote "$cp/deploy/vps/deploy.sh"

# --- 6. migrate ------------------------------------------------------------
Step '6/7 Database schema + context'
Remote "$cp/deploy/vps/migrate.sh"
if ($SkipContext) { Write-Host '  context: skipped (-SkipContext)' -ForegroundColor Yellow }
else { & (Join-Path $PSScriptRoot 'push-context.ps1') -Server $Server -Domain $Domain -Export }

# --- 7. smoke tests --------------------------------------------------------
Step '7/7 Smoke tests'
# Public sites; labflow, ledger and ctx sit behind basic auth, so 401 is right.
$expect = [ordered]@{ panel = 200; rebiomed = 200; english = 200; labflow = 401; ledger = 401; ctx = 401 }
$failed = @()
foreach ($site in $expect.Keys) {
    $code = curl.exe -s -o NUL -w '%{http_code}' -m 20 "https://$site.$Domain/"
    $ok = [int]$code -eq $expect[$site]
    Write-Host ("  {0,-9} {1}  {2}" -f $site, $code, $(if ($ok) { 'ok' } else { "expected $($expect[$site])" }))
    if (-not $ok) { $failed += $site }
}
# Review sync: health is open, the data needs the key.
foreach ($c in @(@('/api/sync/health', 200), @('/api/sync', 401))) {
    $code = curl.exe -s -o NUL -w '%{http_code}' -m 20 "https://english.$Domain$($c[0])"
    $ok = [int]$code -eq $c[1]
    Write-Host ("  {0,-9} {1}  {2}" -f "sync$($c[0].Substring(9))", $code, $(if ($ok) { 'ok' } else { "expected $($c[1])" }))
    if (-not $ok) { $failed += "english$($c[0])" }
}
if ($failed) { throw "Released $tag, but these sites don't answer as expected: $($failed -join ', ')" }

Write-Host "`nReleased $tag." -ForegroundColor Green
Write-Host "Undo (code): on the server, git checkout the previous release-* tag in each repo and rerun deploy.sh."
