# Running the portfolio on one VPS

Everything that runs as containers on the dev machine (Control Panel, its
adapters, LedgerDashboard, ReBiomed, LabFlow, the English lessons, ClinicReport) on a single
Linux server, behind Caddy with automatic HTTPS. wUtility Web stays on Azure;
its adapter reads the Azure demo.

```
internet ──443──> Caddy ─┬─ panel.<domain>     -> frontend (nginx, /api -> core-api)   public, own login
                         ├─ rebiomed.<domain>  -> rebiomed-web -> rebiomed-api -> mongo  public demo
                         ├─ english.<domain>   -> lessons-web (static) + lessons-sync   public (sync needs its key)
                         ├─ ctx.<domain>       -> lessons-web + context.json (file)     basic auth
                         ├─ report.<domain>    -> clinicreport (.NET + React, SQLite)   public demo
                         ├─ labflow.<domain>   -> labflow-web -> labflow-api            basic auth (clinic: -> lab.clinic.<domain>)
                         ├─ ledger.<domain>    -> ledgerdashboard                        basic auth
                         └─ *.clinic.<domain>  -> the clinic platform (section 9)        ClinicHub sign-in
             SQL Server (Express), MongoDB, PostgreSQL, RabbitMQ, core-api, adapters: no published ports
```

| File | Where it runs | What it does |
|---|---|---|
| `bootstrap.sh` | server, once, as root | user, SSH hardening, firewall, fail2ban, auto-updates, swap, Docker |
| `compose.vps.yml` | server | VPS layer over the two base compose files |
| `Caddyfile` | server (caddy container) | HTTPS, basic auth for the private sites |
| `.env.vps.example` | server | template for `/srv/portfolio/ControlPanel/.env` |
| `make-env.sh` | server, once | fills both `.env` files with generated secrets |
| `export-dbs.ps1` | Windows PC | backs up LedgerDashboard and LabFlow for the move |
| `restore-db.sh` | server | restores `.bak` files and recreates the app logins |
| `deploy.sh` | server | pull all repos, rebuild, wait for health |
| `push-context.ps1` | Windows PC | context engine export -> `/srv/portfolio/context` for ctx.<domain> |
| `backup.sh` | server, nightly | SQL + Mongo + PostgreSQL + volumes, 14 days kept, then `backup-offsite.sh` |
| `backup-offsite.sh` | server, nightly | the night's backup and the secrets to object storage, encrypted (restic) |
| `restore-test.sh` | server, monthly | restores the latest off-server copy into scratch databases and checks them |
| `watchdog.sh` | server, every 5 min | containers, disk, memory, certificates, last backup -> healthchecks.io |
| `notify.sh` | (sourced) | the healthchecks.io pings of the three jobs above |
| `install-jobs.sh` | server | puts those jobs in the deploy user's crontab |
| `compose.clinic.yml` | server | the clinic platform over the VPS layer (section 9) |
| `make-clinic-secrets.sh` | server | the clinic platform's secrets, one file each, in `/srv/secrets/clinic` |
| `migrate.sh` | server, each release | schema scripts; with the clinic platform also its databases, logins and RabbitMQ accounts |
| `labflow.caddy` | server (caddy container) | LabFlow's demo site; `../clinic/labflow.caddy` replaces it with the clinic platform |
| `../clinic/` | build + caddy | Dockerfiles, nginx and Caddy sites, SQL logins of the clinic platform |
| `../../.github/workflows/deploy-vps.yml` | GitHub Actions | runs `deploy.sh` after CI passes on main |

## 1. Server

- **Ubuntu 24.04, x86-64** (the SQL Server image doesn't exist for ARM).
- **8 GB RAM, 4 vCPU, 80 GB+ disk.** SQL Server alone wants ~2 GB; with 4 GB
  the builds and the apps won't fit.
- When creating it, add your SSH public key. If you don't have one, on the PC:
  `ssh-keygen -t ed25519` and use `~/.ssh/id_ed25519.pub`.

## 2. Domain and DNS

Five A records, all to the server's IPv4 (and AAAA if it has IPv6):
`panel`, `rebiomed`, `english`, `labflow`, `ledger`. Caddy can only get certificates once
these resolve, so do this early.

## 3. Bootstrap

Log in the way the provider set up: `root`, or on OVH's Ubuntu images the
`ubuntu` user (root login is off there).

```bash
ssh ubuntu@<server-ip>          # or root@
curl -fsSL https://raw.githubusercontent.com/ArashKeshtgar/ControlPanel/main/deploy/vps/bootstrap.sh -o bootstrap.sh
less bootstrap.sh
sudo bash bootstrap.sh
```

Then, **without closing that session**, from a second terminal:
`ssh deploy@<server-ip>`. Only when that works, log out of the first one and,
as `deploy`, remove the provider's default user (it has password-less sudo):
`sudo deluser --remove-home ubuntu && sudo rm -f /etc/sudoers.d/90-cloud-init-users`.
From now on everything is as `deploy`.

## 4. Code, secrets and the JobSearch folder

```bash
cd /srv/portfolio
git clone https://github.com/ArashKeshtgar/ControlPanel.git
git clone https://github.com/ArashKeshtgar/LedgerDashboard.git
git clone https://github.com/ArashKeshtgar/Rebiomed.git
git clone https://github.com/ArashKeshtgar/LabFlow.git
git clone https://github.com/ArashKeshtgar/LanguageLessonDesigner.git

cd ControlPanel
deploy/vps/make-env.sh <your-domain> <your-email>
```

`make-env.sh` writes `.env` and `LedgerDashboard/server/.env` (mode 600) and
generates every password and secret on the server. It asks once for the
basic-auth password and prints the Control Panel and LedgerDashboard logins:
save them in a password manager. The only values it leaves empty are
optional: `ANTHROPIC_API_KEY` and ReBiomed's Stripe test keys.

The JobSearch folder isn't in git. From the PC (PowerShell):

```powershell
scp -r C:\Users\akesh\Downloads\SmartLedgerAI-JobPrep\JobSearch deploy@<server-ip>:/srv/portfolio/
```

## 5. Databases

On the PC, in `D:\E\Projects\ControlPanel`:

```powershell
.\deploy\vps\export-dbs.ps1
scp .\deploy\vps\export\*.bak deploy@<server-ip>:/srv/backups/import/
```

On the server:

```bash
cd /srv/portfolio/ControlPanel
docker compose up -d --wait sqlserver
deploy/vps/restore-db.sh
rm /srv/backups/import/*.bak
```

`restore-db.sh` recreates `ledger_svc`, `ledger_reader` and `labflow_svc` with
the passwords from the two `.env` files, so they must be filled in first.
Control Panel's own databases (ControlPanelDb, HisPlusDemo) are created by
`db-init` on the first deploy.

## 6. First deploy

```bash
deploy/vps/deploy.sh
docker compose --profile seed run --rm rebiomed-seed    # demo listings, once
```

Check:

```bash
docker compose ps                        # all healthy
sudo ss -tlnp | grep -v 127.0.0.53       # only 22, 80, 443 on 0.0.0.0
curl -I https://panel.<domain>
```

## 7. Deploy from GitHub

A separate key that can do nothing on the server except run `deploy.sh`.

On the PC:

```powershell
ssh-keygen -t ed25519 -N '""' -C github-deploy -f $HOME\.ssh\github-deploy
```

On the server, append one line to `~/.ssh/authorized_keys` (the key is the
content of `github-deploy.pub`):

```
restrict,command="/srv/portfolio/ControlPanel/deploy/vps/deploy.sh" ssh-ed25519 AAAA... github-deploy
```

In the ControlPanel repo on GitHub, Settings -> Secrets and variables -> Actions:

- secret `VPS_HOST`: the server's IP or hostname
- secret `VPS_SSH_KEY`: the content of `github-deploy` (the private key)
- secret `VPS_KNOWN_HOSTS`: output of `ssh-keyscan -t ed25519 <server-ip>`;
  compare its fingerprint (`ssh-keygen -lf`) with the one bootstrap.sh printed
  or the provider's console before trusting it
- variable `VPS_DEPLOY_ENABLED`: `true`

A push to ControlPanel's main deploys after CI passes. After pushing one of
the other repos, run the workflow by hand (Actions -> Deploy to VPS -> Run).

## 8. Backups and scheduled jobs

```bash
deploy/vps/install-jobs.sh
```

puts four jobs in the deploy user's crontab (server time, UTC): `backup.sh` nightly at 03:30, `restore-test.sh` on
the 1st of each month at 05:00, `watchdog.sh` every 5 minutes, and a weekly trim of their logs in `/srv/backups`.
Run `backup.sh` once by hand and look in `/srv/backups/daily/`. Restoring a nightly database:
`deploy/vps/restore-db.sh /srv/backups/daily/<stamp>/LabFlow.bak.gz` (the clinic databases too: their logins and
owners are made again).

What a night's folder holds: every SQL Server database (ClinicHub's catalog and one per clinic are found by name),
ReBiomed's MongoDB, IntegrationHub's PostgreSQL (`pg_dump`), and the volumes that can't be rebuilt: uploads, the
lessons' sync data, ClinicHub's Data Protection keys (without them two-factor secrets and clinic connection strings
can't be read), the connected ClinicReport's databases and Analytics' warehouse with its finance extracts.

### Off-server backups

The local copies die with the server, so `backup-offsite.sh` sends each night's folder and `/srv/secrets` (not
`/srv/secrets/backup`) to object storage with [restic](https://restic.net), run from its container: encrypted on the
server before it leaves (AES-256), deduplicated, thinned to 14 daily, 8 weekly and 12 monthly snapshots. Until it is
configured, backup.sh says so every night and healthchecks.io's `backup-offsite` check stays failed.

1. OVH Control Panel -> Public Cloud -> Object Storage -> create a container (S3 API, region **BHS**, Beauharnois:
   the data stays in Canada), and an S3 user with read/write on it. Under 1 GB here: a few cents a month.
2. On the server, as deploy (`umask 077` first, so the file is born mode 600):

   ```bash
   umask 077; mkdir -p /srv/secrets/backup
   cat > /srv/secrets/backup/restic.env <<'EOF'
   RESTIC_REPOSITORY=s3:https://s3.bhs.io.cloud.ovh.net/<container>
   RESTIC_PASSWORD=<openssl rand -base64 48>
   AWS_ACCESS_KEY_ID=<the S3 user's access key>
   AWS_SECRET_ACCESS_KEY=<its secret key>
   AWS_DEFAULT_REGION=bhs
   EOF
   ```

3. **Put RESTIC_PASSWORD in the password manager now.** The copies can't be read without it, and the copy on the
   server goes with the server.
4. `deploy/vps/backup.sh` by hand, then `deploy/vps/restore-test.sh`: it checks the repository, restores the latest
   snapshot into a scratch folder, restores every database as `RestoreTest_<name>`, runs `DBCC CHECKDB`, drops it
   again, reads the PostgreSQL dump and every archive. It runs by itself on the 1st of each month.

Another provider only changes `RESTIC_REPOSITORY` (any S3, B2, `sftp:`). For real patient data it has to stay in
Canada, as BHS does.

## 9. The clinic platform

ClinicHub, ClinicReport (connected), LabFlow, PharmaFlow, FinancePowerApp, IntegrationHub and Analytics, as in the
PC's `via-hub` profiles but in Production: every application signs people in through ClinicHub, with real accounts,
no demo users and no development keys, and they talk to each other through the hub. Layered over the VPS layer by
[`compose.clinic.yml`](compose.clinic.yml).

```
*.clinic.<domain> ──> Caddy ─┬─ hub.          -> clinichub (pages + API + OpenID Connect issuer)
                             ├─ report.       -> clinicreport-clinic (SQLite per clinic)
                             ├─ lab.          -> labflow-web, /api /signin-oidc -> labflow-api
                             ├─ pharmacy.     -> pharmaflow-web, /api /signin-oidc -> pharmaflow-api
                             ├─ finance.      -> finance-web, /api /signin-oidc -> finance-api
                             ├─ analytics.    -> analytics-web -> analytics-api (+ scheduler, consumer)
                             └─ integration.  -> integrationhub-web -> integrationhub
      orders, results, prescriptions, money: app -> integrationhub:5700/route/... -> app   (inside Docker only)
      SQL Server: ClinicHub_Catalog, ClinicHub_<clinic>, LabFlow, PharmaFlow, FinancePowerApp
      PostgreSQL + RabbitMQ: the hub's message log and the de-identified events for Analytics
```

> **Synthetic data only.** This is the production setup, but no real patient may be entered before the privacy
> impact assessment, the agreements with the clinics, and a security review. HL7 to a lab and OLIS stay off.

**Secrets** are files, not `.env` lines: `make-clinic-secrets.sh` generates every password, client secret and key on
the server into `/srv/secrets/clinic` (folder mode 700, owned by deploy), and each container gets only its own,
where its framework reads them: `/run/secrets/<setting>` for .NET (`AddKeyPerFile`), Python (pydantic `secrets_dir`)
and Spring (`configtree:`), a file path for PostgreSQL, RabbitMQ and ClinicHub's token signing certificate. One file
can reach two containers under two names (an application's ClinicHub secret is `Sso__Clients__<n>__ClientSecret` in
ClinicHub and `ClinicHub__ClientSecret` in the application). Rotating one: delete its file, run the script again,
then `migrate.sh` (database passwords) and `docker compose up -d`.

### Turning it on (once)

1. **DNS** (OVH Control Panel, `arashkeshtgar.ca` zone): one record, `*.clinic` A `144.217.4.240`. Caddy then gets
   a certificate for each of the seven names by itself.
2. **The secrets folder** (a server bootstrapped before this needs it once): `sudo install -d -o deploy -g deploy -m 700 /srv/secrets`
3. **.env**: add `deploy/vps/compose.clinic.yml` to `COMPOSE_FILE` and the clinic block from `.env.vps.example`
   (`CLINIC_DOMAIN=clinic.arashkeshtgar.ca` and the repo folders).
4. As deploy:

   ```bash
   cd /srv/portfolio/ControlPanel
   git pull --ff-only
   deploy/vps/make-clinic-secrets.sh
   deploy/vps/deploy.sh                 # clones the five repos, makes the databases and logins, builds, starts
   docker compose run --rm clinichub seed-demo
   docker compose run --rm clinichub admin arash "Arash Keshtgar" harbourview lakeshore
   ```

   `seed-demo` adds the two fictional clinics with synthetic patients; their staff accounts get random passwords
   nobody knows. `admin` prints a temporary password: sign in at `https://hub.clinic.<domain>`, change it, turn on
   two-factor, then create the people you want under Users (each gets a temporary password too). Run `admin` again
   whenever the password is lost: it resets it.

### Giving someone a demo account (an interviewer, a reviewer)

The platform stays private, so each viewer gets their own account with one role. About two minutes, no server access:

1. Sign in at `https://hub.clinic.<domain>`, pick the clinic in the top bar (Harbourview or Lakeshore), open **People** -> **Add person**.
2. User name `firstname.lastname`, a **temporary password** (16+ characters from the password manager), their name, and **one role**:

   | Viewer wants to see | Role |
   |---|---|
   | Charts, orders, prescriptions (clinician's view) | Physician |
   | Booking, check-in | Front desk |
   | Lab results and specimens (LabFlow) | Lab technologist |
   | The pharmacy (PharmaFlow) | Pharmacist |
   | Claims, invoices, the books (FinancePowerApp) | Billing clerk |
   | Everything, including People and Logs | Administrator (only for someone you trust) |

3. Send the user name and the link `https://hub.clinic.<domain>` in one message and the temporary password in another,
   by a different channel. They change it at first sign-in and set up two-factor.
4. Afterwards: under **People**, take their role away (or disable the person, whichever the row offers) so the account can't be used again, and look
   under **Logs** -> *Sign-ins and accounts* to see what they did.

Everything they can reach is fictional data (`seed-demo`); nothing they do needs cleaning up except that account.

LabFlow becomes the clinic's lab: `labflow.<domain>` redirects to `lab.clinic.<domain>`, its basic auth goes, and
people sign in through ClinicHub (Lab technologist, Front desk, Nurse roles). The public ClinicReport demo at
`report.<domain>` stays as it is.

## 10. Monitoring

[healthchecks.io](https://healthchecks.io) watches from outside (free for up to 20 checks): each job pings it, and it
alerts by e-mail when a job reports a failure **or when the pings stop** (the server down, Docker stopped, cron
broken), which no check on the server itself can notice.

1. Create an account and a project; under Settings, create a **ping key**.
2. On the server: `umask 077; echo 'HC_PING_KEY=<key>' > /srv/secrets/monitoring.env`
3. `deploy/vps/watchdog.sh` by hand. The first ping of each job creates its check (`watchdog`, `backup`,
   `backup-offsite`, `restore-test`). In healthchecks.io set their schedules: watchdog every **5 minutes**, grace
   **10 minutes**; backup and backup-offsite daily, grace 2 hours; restore-test monthly (cron `0 5 1 * *`), grace 1 day.

`watchdog.sh` reports a failure, with what is wrong, when a container is unhealthy, restarting or exited with an
error; when `/` is 85% full or under 300 MB of memory is free; when a site's certificate has under 14 days left
(Caddy renews at 30, so that means renewal is failing); or when the last local backup is over 26 hours old.

For a view from outside of the sites themselves, add HTTP monitors (UptimeRobot's free plan, or healthchecks.io's
paid one) for `https://hub.clinic.<domain>/healthz` and the public sites.

## Day to day

| | |
|---|---|
| Logs | `docker compose logs -f --tail 100 <service>` |
| Memory | `docker stats --no-stream` |
| Restart one app | from the Control Panel Services page, or `docker compose restart <service>` |
| OS updates | security ones install themselves; `sudo apt upgrade` + reboot now and then |
| Failed SSH logins | `sudo fail2ban-client status sshd` |

## Why things are the way they are

- **No published ports except Caddy's.** Docker bypasses ufw, so a published
  port is open to the internet no matter what the firewall says.
  `compose.vps.yml` removes them with `!reset` (Compose 2.24+).
- **SQL Server Express.** Developer edition isn't licensed for anything the
  public can reach. Express caps a database at 10 GB, far above what's here.
- **Basic auth on LabFlow and LedgerDashboard.** Without the clinic platform
  LabFlow runs as Development, where its demo sign-in is a role switcher with no
  password; LedgerDashboard holds the job search. Both are for the owner, and
  whoever gets the password. With the clinic platform LabFlow signs in through
  ClinicHub instead and needs no basic auth.
- **The clinic platform's containers reach Caddy under the public names**
  (network aliases), so a token's issuer, `https://hub.clinic.<domain>/`, is the
  same address inside Docker and in the browser, without leaving the server.
- **Control Panel is public** with its own login. Give people the viewer
  account; only Admin can start and stop services.
