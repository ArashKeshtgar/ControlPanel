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

1. Copy `services/adapters/hisplus-adapter` (DB-read) or `wutility-adapter` (proxy) as a starting point.
2. Implement `GET /status` for the new project.
3. `npm install`, run it on the next free port.
4. `UPDATE dbo.Projects SET AdapterBaseUrl = 'http://localhost:PORT' WHERE [Key] = 'the-project-key'` in `ControlPanelDb` (already seeded with all 9 projects — most just point at an adapter that doesn't exist yet, which is why they show "Offline" today).

No changes to `core-api` or the frontend are ever needed to add a project — that's the aggregation pattern doing its job.

## Auth

Real JWT (15-minute access token + 7-day refresh token) with role-based access control (`Admin` / `Viewer`) enforced by a Nest guard reading `@Roles(...)` metadata. Two seeded users:
- `admin` / `ChangeMe123!` — can also add/edit/remove projects and adapter ports on the "Manage ports" page
- `viewer` / `ViewerPass123!` — read-only; `PUT/POST/DELETE /projects` correctly return 403 for this user (verified)

**Change both passwords before showing the app to anyone else.**

## Managing adapter ports

The dashboard's "Manage ports" button (Admin only) opens `/manage-ports`: edit any project's adapter base URL/port inline, toggle a project active/disabled, add a new project row (for the next adapter you build), or remove one — all backed by real `PUT`/`POST`/`DELETE /projects` endpoints, no more manual SQL needed for this.

## Database

SQL Server, dedicated login `controlpanel_svc` (SQL auth, not Windows-integrated — Node's `mssql` package uses the pure-JS `tedious` driver by default, which only supports SQL auth without extra native compilation). Two databases: `ControlPanelDb` (Users, Projects registry) and `HisPlusDemo` (a safe stand-in for the real HIS+ database — this **never** points at real hospital data).

## Running locally (no Docker)

```bash
# one-time
cd services/core-api && npm install
cd services/adapters/wutility-adapter && npm install
cd services/adapters/hisplus-adapter && npm install
cd frontend && npm install

# each in its own terminal
cd services/core-api && npm run start:dev              # :4000
cd services/adapters/wutility-adapter && npm run start:dev  # :4001
cd services/adapters/hisplus-adapter && npm run start:dev   # :4002
cd frontend && npx ng serve --port 4100                 # :4100
```

wUtility Web's own API must also be running on `:5091` for `wutility-adapter` to have something to proxy.

## Running via Docker Compose

```bash
DB_PASSWORD=Cp!Dev_2026Local JWT_SECRET=dev-only-b7f3a1c9e2d4-change-in-production docker compose up --build
```

SQL Server and wUtility Web's API stay on the host (shared dev infrastructure, not something this compose file should own) — containers reach them via `host.docker.internal`. **Before running this way**, update the `Projects` registry's adapter URLs from `http://localhost:PORT` to the container service names (`http://wutility-adapter:4001`, `http://hisplus-adapter:4002`) so `core-api`'s container can actually resolve them.

## What's deliberately not built (yet)

- Message-queue-based async status push (RabbitMQ) — for a status dashboard, synchronous REST composition with a short per-adapter timeout is simpler and equally correct; there's no async workflow here that would benefit from a queue.
- The remaining 7 adapters — same two patterns, not yet copy-pasted for the other 7 projects.
