# Control Panel

A central status portal for the project portfolio: every existing project is fronted by its own small adapter microservice, and `core-api` aggregates their live status into one dashboard.

## Architecture

```
Angular frontend (4100)
        │  JWT bearer token
        ▼
   core-api (4000)  ── NestJS, TypeScript, SQL Server
        │  auth (login/refresh), RBAC guard, project registry
        │  GET /projects → fetches /status from every adapter in parallel
        ▼
┌───────────────┬───────────────┬─────────────────────────┐
│ wutility-      │ hisplus-      │ ... one adapter per      │
│ adapter (4001) │ adapter (4002)│ remaining project        │
│ proxy pattern  │ direct-DB-read│ (see "Adding an adapter")│
└───────────────┴───────────────┴─────────────────────────┘
```

Every adapter exposes exactly one contract — `GET /status` returning:

```ts
{ healthy: boolean; summary?: string; metrics?: Record<string, string | number>; error?: string }
```

`core-api` never talks to a project's database or API directly — only to its adapter's `/status` endpoint. That's the whole point of the pattern: `core-api` and the frontend don't need to know anything about how HIS+ or wUtility actually work internally.

## Two adapter patterns (both built, both proven)

1. **Proxy pattern** (`wutility-adapter`) — for a project that already has its own HTTP API (wUtility Web, DbaOpsConsole, LedgerDashboard, mern-animation-project all qualify). The adapter just calls that real API and normalizes the response.
2. **Direct-DB-read pattern** (`hisplus-adapter`) — for a project with no API at all (HIS+, DrOffice are plain WinForms desktop apps). The adapter connects read-only to the project's SQL Server database and computes real metrics from the same tables the desktop app writes to.

`JobSearch/engine` and `English Engine` don't have a SQL database either — their adapter would read the ledger CSV / lesson output folder directly, a third minor variant of pattern 2.

## Adding the next adapter

1. Copy `services/adapters/hisplus-adapter` (DB-read) or `wutility-adapter` (proxy) as a starting point. Each adapter keeps its logic in `src/app.ts` (a `createApp(...)` factory with its dependencies injected) and its wiring in `src/main.ts`, so `/status` can be tested without a real database or upstream API.
2. Implement `GET /status` for the new project and add an `app.spec.ts` next to it.
3. `npm install`, run it on the next free port.
4. Point the project's row at it from the **Manage ports** page. The registry is already seeded with all 9 projects; the ones without an adapter yet show "Offline". If the adapter runs on a new host name, add that host to `ADAPTER_ALLOWED_HOSTS` first (see Security).

No changes to `core-api` or the frontend are ever needed to add a project — that's the aggregation pattern doing its job.

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

## Managing adapter ports

The dashboard's "Manage ports" button (Admin only) opens `/manage-ports`: edit any project's adapter base URL/port inline, toggle a project active/disabled, add a new project row (for the next adapter you build), or remove one — all backed by real `PUT`/`POST`/`DELETE /projects` endpoints. A URL outside the allowlist is rejected with the server's explanation.

## Database

SQL Server, dedicated login `controlpanel_svc` (SQL auth, not Windows-integrated — Node's `mssql` package uses the pure-JS `tedious` driver by default, which only supports SQL auth without extra native compilation). Two databases: `ControlPanelDb` (Users, Projects registry) and `HisPlusDemo` (a safe stand-in for the real HIS+ database, with made-up demo rows — this **never** points at real hospital data).

Everything needed to create them is in [`db/`](db/). Every script is safe to re-run:

| Script | What it does |
|---|---|
| `01-databases.sql` | Creates `ControlPanelDb` and `HisPlusDemo` |
| `02-service-login.sql` | Creates or updates the `controlpanel_svc` login and its least-privilege roles (needs `DB_PASSWORD`) |
| `03-controlpanel-schema.sql` | `Users` and `Projects` tables, plus column migrations for existing databases |
| `04-controlpanel-seed.sql` | The 9-project registry (existing rows are never overwritten) |
| `05-hisplus-demo.sql` | The `ORReports` table and a few demo rows |

## Running via Docker Compose (recommended)

```bash
cp .env.example .env   # fill in every value; the file shows how to generate secrets
docker compose up --build
```

This starts SQL Server in its own container (published on `14333`, so it doesn't clash with a local instance), runs `db/*.sql` through the one-shot `db-init` service, creates the two users through `seed-users`, then starts `core-api`, both adapters and the frontend on http://localhost:4100. The registry is seeded with container host names, so there's no manual step. Compose stops with a clear message if any variable in `.env` is missing.

The only piece outside this file is wUtility Web's .NET API (a separate repo). Start it on the host with the same `WUTILITY_API_KEY`; until then the wUtility card shows "unreachable".

## Running locally (no Docker)

Against a local SQL Server, from the `db/` folder (Windows `sqlcmd`, integrated auth):

```bash
sqlcmd -S . -E -b -i 01-databases.sql
sqlcmd -S . -E -b -i 02-service-login.sql -v DB_PASSWORD="<password for controlpanel_svc>"
sqlcmd -S . -E -b -i 03-controlpanel-schema.sql
sqlcmd -S . -E -b -i 04-controlpanel-seed.sql -v ADAPTER_HOST=localhost WUTILITY_ADAPTER=localhost:4001 HISPLUS_ADAPTER=localhost:4002
sqlcmd -S . -E -b -i 05-hisplus-demo.sql
```

Then copy `services/core-api/.env.example` to `services/core-api/.env`, fill it in, and:

```bash
npm install                                   # once, from the repo root (npm workspaces)
cd services/core-api && npm run build && node --env-file=.env dist/scripts/seed-users.js

# each in its own terminal (the adapters need DB_PASSWORD / WUTILITY_API_KEY set)
cd services/core-api && npm run start:dev                   # :4000
cd services/adapters/wutility-adapter && npm run start:dev  # :4001
cd services/adapters/hisplus-adapter && npm run start:dev   # :4002
cd frontend && npx ng serve --port 4100                     # :4100
```

## Tests

| Where | Run | Covers |
|---|---|---|
| `services/core-api` | `npm test` (Jest) | Login, token types and secrets, refresh, logout revocation, RBAC guard, secret validation, SSRF allowlist |
| `services/adapters/*` | `npm test` (Jest) | Each adapter's `/status` over real HTTP with the upstream API or database faked: success, upstream errors, timeouts, empty tables |
| `frontend` | `npm run test:ci` (Karma, headless Chrome) | Token storage, transparent refresh-and-retry, one shared refresh, session end on a rejected refresh, server-side logout, admin route guard |

CI runs all of them, plus the production builds and all four Docker images, on every push.

## What's deliberately not built (yet)

- Message-queue-based async status push (RabbitMQ) — for a status dashboard, synchronous REST composition with a short per-adapter timeout is simpler and equally correct; there's no async workflow here that would benefit from a queue.
- The remaining 7 adapters — same two patterns, not yet copy-pasted for the other 7 projects.
