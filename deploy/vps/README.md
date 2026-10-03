# Running the portfolio on one VPS

Everything that runs as containers on the dev machine (Control Panel, its
adapters, LedgerDashboard, ReBiomed, LabFlow, the English lessons) on a single
Linux server, behind Caddy with automatic HTTPS. wUtility Web stays on Azure;
its adapter reads the Azure demo.

```
internet ──443──> Caddy ─┬─ panel.<domain>     -> frontend (nginx, /api -> core-api)   public, own login
                         ├─ rebiomed.<domain>  -> rebiomed-web -> rebiomed-api -> mongo  public demo
                         ├─ english.<domain>   -> lessons-web (static)                  public
                         ├─ ctx.<domain>       -> lessons-web + context.json (file)     basic auth
                         ├─ labflow.<domain>   -> labflow-web -> labflow-api            basic auth
                         └─ ledger.<domain>    -> ledgerdashboard                        basic auth
             SQL Server (Express), MongoDB, core-api, adapters: no published ports
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
| `backup.sh` | server, nightly | SQL + Mongo + uploads, 14 days kept |
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

## 8. Backups

```bash
crontab -e
# add:
30 3 * * * /srv/portfolio/ControlPanel/deploy/vps/backup.sh >> /srv/backups/backup.log 2>&1
```

Run it once by hand and look in `/srv/backups/daily/`. Restoring a nightly
database: `deploy/vps/restore-db.sh /srv/backups/daily/<stamp>/LabFlow.bak.gz`.

**Off-server copy:** these backups die with the server. At minimum, pull them
to the PC now and then:
`scp -r deploy@<server-ip>:/srv/backups/daily .\vps-backups`.
The provider's own snapshot/backup option (usually ~20% of the server price)
is the easy upgrade.

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
- **Basic auth on LabFlow and LedgerDashboard.** LabFlow runs as Development,
  where its demo sign-in is a role switcher with no password; LedgerDashboard
  holds the job search. Both are for the owner, and whoever gets the password.
- **Control Panel is public** with its own login. Give people the viewer
  account; only Admin can start and stop services.
