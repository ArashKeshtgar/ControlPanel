# Control Panel

A central status portal for the project portfolio: every existing project is fronted by its own small adapter microservice, and `core-api` aggregates their live status into one dashboard. An optional AI assistant answers questions about that live data ("which applications need a follow-up?") through read-only tools.

## Architecture

```
Angular frontend (4100)
        │  JWT bearer token
        ▼
   core-api (4000)  ── NestJS, TypeScript, SQL Server
        │  auth (login/refresh), RBAC guard, project registry
        │  GET /projects → fetches /status from every adapter in parallel
        │  POST /assistant/ask → Claude, with read-only tools over the same data
        ▼
┌───────────────┬───────────────┬────────────────┬──────────────────┐
│ wutility-      │ hisplus-      │ ledgerdash-     │ ... one adapter  │
│ adapter (4001) │ adapter (4002)│ adapter (4006)  │ per remaining    │
│ proxy pattern  │ direct-DB-read│ DB-read (views) │ project          │
└───────────────┴───────────────┴────────────────┴──────────────────┘
```

Every adapter exposes exactly one contract — `GET /status` returning:

```ts
{ healthy: boolean; summary?: string; metrics?: Record<string, string | number>; error?: string }
```

`core-api` never talks to a project's database or API directly — only to its adapter's `/status` endpoint. That's the whole point of the pattern: `core-api` and the frontend don't need to know anything about how HIS+ or wUtility actually work internally.

## Two adapter patterns (both built, both proven)

1. **Proxy pattern** (`wutility-adapter`) — for a project that already has its own HTTP API (wUtility Web, DbaOpsConsole, LedgerDashboard, mern-animation-project all qualify). The adapter just calls that real API and normalizes the response.
2. **Direct-DB-read pattern** (`hisplus-adapter`, `ledgerdash-adapter`) — for a project whose data lives in SQL Server. `hisplus-adapter` reads HIS+'s tables (a WinForms app with no API). `ledgerdash-adapter` reads LedgerDashboard's database only through its reporting views (`db/04-views.sql` in that repo) with a login that can't see the tables at all, so its numbers match the dashboard's own UI exactly. Besides `/status` it serves read-only `/insights/followups`, `/insights/funnel` and `/insights/gaps` for the assistant.

`JobSearch/engine` and `English Engine` don't have a SQL database either — their adapter would read the ledger CSV / lesson output folder directly, a third minor variant of pattern 2.

## Adding the next adapter

1. Copy `services/adapters/hisplus-adapter` (DB-read) or `wutility-adapter` (proxy) as a starting point. Each adapter keeps its logic in `src/app.ts` (a `createApp(...)` factory with its dependencies injected) and its wiring in `src/main.ts`, so `/status` can be tested without a real database or upstream API.
2. Implement `GET /status` for the new project and add an `app.spec.ts` next to it.
3. `npm install`, run it on the next free port.
4. Point the project's row at it from the **Manage ports** page. The registry is already seeded with all 9 projects; the ones without an adapter yet show "Offline". If the adapter runs on a new host name, add that host to `ADAPTER_ALLOWED_HOSTS` first (see Security).

No changes to `core-api` or the frontend are ever needed to add a project — that's the aggregation pattern doing its job.

## AI assistant

The dashboard's **Ask the portfolio** box sends a question to `POST /assistant/ask` (any signed-in user). `core-api` runs a tool-use loop with Claude (`claude-opus-5`) over three read-only tools:

| Tool | Reads |
|---|---|
| `list_projects` | every project's live `/status` (same data as the dashboard) |
| `get_project_status` | one project's status and metrics |
| `get_job_search_insight` | `followups`, `funnel` or `gaps` from `ledgerdash-adapter`'s `/insights/*` |

Design choices:

- **Read-only by construction.** No tool writes, runs SQL or takes a URL; insight paths come from a fixed list and go through the same SSRF allowlist as `/status`. Asked to change something, it says where to do it instead.
- **Tool data is treated as data.** The system prompt says so, and there is nothing a prompt-injected result could make it do.
- **Bounded:** at most 6 model turns per question, 20 questions per user per hour, parallel tool calls answered together, `refusal` / `max_tokens` handled explicitly, server-side `fallbacks: "default"` for declined requests.
- **Optional.** Without `ANTHROPIC_API_KEY` the rest of `core-api` runs normally and the endpoint answers 503.
- Answers come back in the question's language, as plain text (never rendered as HTML).

## Auth

JWT with role-based access control (`Admin` / `Viewer`) enforced by a Nest guard reading `@Roles(...)` metadata:

- **Access token** — 15 minutes, signed with `JWT_SECRET`, carries `typ: "access"`. The only token the Bearer guard accepts.
- **Refresh token** — 7 days, signed with a *separate* `JWT_REFRESH_SECRET`, carries `typ: "refresh"` and the user's `TokenVersion`. It can't be used as a Bearer token (wrong secret *and* wrong `typ`), and an access token can't be used at `/auth/refresh`.
- **Refresh** (`POST /auth/refresh`) re-reads the user, so a changed role or a deleted user takes effect immediately, and returns a new token pair. The frontend does this transparently: on a `401` it refreshes once (a single shared call, even when several requests fail together) and retries.
- **Logout** (`POST /auth/logout`) bumps `TokenVersion`, which revokes every refresh token issued to that user. Access tokens already issued expire on their own within 15 minutes. Re-seeding a user's password does the same.
- **No default secrets.** `core-api` refuses to start if either secret is missing, shorter than 32 characters, or if the two are equal.

Two built-in accounts, `admin` and `viewer`, are created by `npm run seed:users` (or the `seed-users` compose service) from `ADMIN_PASSWORD` / `VIEWER_PASSWORD`. No password is stored in this repo.

Known limitations: tokens live in `localStorage`, which an XSS bug could read (an httpOnly cookie for the refresh token is the next hardening step), and earlier refresh tokens stay valid until logout or expiry — there is no per-token reuse detection.

## Security

- **SSRF allowlist.** `core-api` requests `<adapterBaseUrl>/status` for every registry row, so the registry is a list of URLs the server will fetch. `adapterBaseUrl` must be a plain `http(s)://host[:port]` whose host is listed in `ADAPTER_ALLOWED_HOSTS`. This is checked on create/update (returns `400` with the reason) and again at fetch time, so rows edited directly in SQL can't bypass it. Redirects are not followed.
- **wUtility API key.** `wutility-adapter` sends `X-Api-Key` (`WUTILITY_API_KEY`); wUtility Web's API rejects every `/api/*` request without it, including its script-execution endpoint.
- **Least-privilege DB login.** `controlpanel_svc` gets read/write on `ControlPanelDb` (no `db_owner`, no DDL) and read-only on `HisPlusDemo`.
- **No committed secrets.** Every password, key and JWT secret comes from the environment; each service refuses to start without the ones it needs.

## Service control (Docker)

Under Docker Compose every long-running service has `restart: unless-stopped` and a healthcheck, so a crash is recovered without anyone watching. The **Services** page (`/services`) lists the managed containers with their state and health, refreshed every 5 seconds; an Admin can start, stop or restart them and read their recent logs.

```
browser ──JWT──▶ core-api ──(internal network)──▶ socket-proxy ──ro──▶ /var/run/docker.sock
                  │ RBAC, name allowlist, audit          list · logs · start · stop only
                  ▼
             dbo.AuditLog (insert-only)
```

- **Least privilege at the Docker API.** core-api never mounts the Docker socket. It talks to `socket-proxy` ([linuxserver/socket-proxy](https://github.com/linuxserver/docker-socket-proxy), pinned), on an `internal` network that only core-api joins, and the proxy forwards only container list, logs, start and stop. Create, exec, delete, kill, images, volumes, networks and `/info` answer `403` there, so even a bug in core-api can't run a new container or a shell. The proxy's restart permission also allows `kill`, so it's left off and core-api restarts as stop + start.
- **Label allowlist.** Only containers labelled `controlpanel.managed=true` are listed or controlled, addressed by their `controlpanel.service` name. The container id sent to Docker always comes from a fresh filtered listing, never from the request. core-api, the frontend, SQL Server and the proxy carry no label, so the panel can't switch itself off.
- **RBAC and confirmation.** Anyone signed in sees the list. Start, stop, restart, logs and the audit list are Admin-only. Stop and restart need the service name typed back, and the API checks it (`{"confirm": "<name>"}`), not just the UI. One action per service at a time (`409` otherwise).
- **Audit.** Every attempt, including refused and failed ones, is a row in `dbo.AuditLog` (who, what, which service, result). `controlpanel_svc` is denied `UPDATE` and `DELETE` on that table.
- **Logs** are the last 200 lines (500 at most), demultiplexed from Docker's stream format, with bearer tokens, JWTs, API keys and `password=`/`secret=`/`token=` values masked.
- **The AI assistant stays read-only**: it has no access to these endpoints.

The endpoints: `GET /services`, `POST /services/:name/start|stop|restart`, `GET /services/:name/logs?tail=`, `GET /services/audit`. Without `DOCKER_PROXY_URL` (core-api run with npm on the host) they answer `503`.

The Docker-specific code is one class, `DockerOrchestrator`, behind an `Orchestrator` interface (`list`, `start`, `stop`, `restart`, `logs`). A Kubernetes implementation (scale a Deployment to 0/1, rollout restart, pod logs, with a namespaced ServiceAccount instead of the proxy) can replace it without changing the controller, the audit or the UI.

To put another service under control, give its compose service these labels:

```yaml
    labels:
      controlpanel.managed: "true"
      controlpanel.service: my-service        # lowercase, digits, - _ .
      controlpanel.display: "My service"
```

## Managing adapter ports

The dashboard's "Manage ports" button (Admin only) opens `/manage-ports`: edit any project's adapter base URL/port inline, toggle a project active/disabled, add a new project row (for the next adapter you build), or remove one — all backed by real `PUT`/`POST`/`DELETE /projects` endpoints. A URL outside the allowlist is rejected with the server's explanation.

## Database

SQL Server, dedicated login `controlpanel_svc` (SQL auth, not Windows-integrated — Node's `mssql` package uses the pure-JS `tedious` driver by default, which only supports SQL auth without extra native compilation). Two databases: `ControlPanelDb` (Users, Projects registry) and `HisPlusDemo` (a safe stand-in for the real HIS+ database, with made-up demo rows — this **never** points at real hospital data).

Everything needed to create them is in [`db/`](db/). Every script is safe to re-run:

| Script | What it does |
|---|---|
| `01-databases.sql` | Creates `ControlPanelDb` and `HisPlusDemo` |
| `02-service-login.sql` | Creates or updates the `controlpanel_svc` login and its least-privilege roles (needs `DB_PASSWORD`) |
| `03-controlpanel-schema.sql` | `Users`, `Projects` and `AuditLog` tables, plus column migrations for existing databases |
| `04-controlpanel-seed.sql` | The 9-project registry (existing rows are never overwritten) |
| `05-hisplus-demo.sql` | The `ORReports` table and a few demo rows |

## Running via Docker Compose (recommended)

```bash
cp .env.example .env   # fill in every value; the file shows how to generate secrets
docker compose up --build
```

This starts SQL Server in its own container (published on `14333`, so it doesn't clash with a local instance), runs `db/*.sql` through the one-shot `db-init` service, creates the two users through `seed-users`, then starts `core-api`, the socket proxy, the three adapters and the frontend on http://localhost:4100 (set `FRONTEND_PORT` in `.env` if 4100 is taken; core-api allows that origin automatically). The registry is seeded with container host names, so there's no manual step. Compose stops with a clear message if any variable in `.env` is missing.

The only piece outside this file is wUtility Web's .NET API (a separate repo). Start it on the host with the same `WUTILITY_API_KEY`; until then the wUtility card shows "unreachable".

## Running locally (no Docker)

Against a local SQL Server, from the `db/` folder (Windows `sqlcmd`, integrated auth):

```bash
sqlcmd -S . -E -b -i 01-databases.sql
sqlcmd -S . -E -b -i 02-service-login.sql -v DB_PASSWORD="<password for controlpanel_svc>"
sqlcmd -S . -E -b -i 03-controlpanel-schema.sql
sqlcmd -S . -E -b -i 04-controlpanel-seed.sql -v ADAPTER_HOST=localhost WUTILITY_ADAPTER=localhost:4001 HISPLUS_ADAPTER=localhost:4002 LEDGERDASH_ADAPTER=localhost:4006
sqlcmd -S . -E -b -i 05-hisplus-demo.sql
```

Then copy `services/core-api/.env.example` to `services/core-api/.env`, fill it in, and:

```bash
npm install                                   # once, from the repo root (npm workspaces)
cd services/core-api && npm run build && node --env-file=.env dist/scripts/seed-users.js

# each in its own terminal (the adapters need DB_PASSWORD / WUTILITY_API_KEY set;
# ledgerdash-adapter's DB_PASSWORD is LedgerDashboard's ledger_reader password)
cd services/core-api && npm run start:dev                     # :4000
cd services/adapters/wutility-adapter && npm run start:dev    # :4001
cd services/adapters/hisplus-adapter && npm run start:dev     # :4002
cd services/adapters/ledgerdash-adapter && npm run start:dev  # :4006
cd frontend && npx ng serve --port 4100                     # :4100
```

## Tests

| Where | Run | Covers |
|---|---|---|
| `services/core-api` | `npm test` (Jest) | Login, token types and secrets, refresh, logout revocation, RBAC guard, secret validation, SSRF allowlist; service control (label allowlist, ids only from the listing, names that could change the URL, restart as stop + start, proxy refusals, log demux and masking, confirmation, one action at a time, audit on success and failure, Admin-only routes); the assistant's tool loop with a scripted fake Claude client (parallel tools, error results, refusal, turn cap, rate limit, not-configured 503) |
| `services/adapters/*` | `npm test` (Jest) | Each adapter's `/status` over real HTTP with the upstream API or database faked: success, upstream errors, timeouts, empty tables |
| `frontend` | `npm run test:ci` (Karma, headless Chrome) | Token storage, transparent refresh-and-retry, one shared refresh, session end on a rejected refresh, server-side logout, admin route guard, the assistant panel, service-control error messages |

CI runs all of them, plus the production builds and all five Docker images, on every push.

## What's deliberately not built (yet)

- Message-queue-based async status push (RabbitMQ) — for a status dashboard, synchronous REST composition with a short per-adapter timeout is simpler and equally correct; there's no async workflow here that would benefit from a queue.
- The remaining 6 adapters — same two patterns, not yet built for the other 6 projects.
- Status history and a daily AI digest — the assistant sees live status only; storing snapshots would let it answer "what changed since yesterday?".
