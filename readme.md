# Arham Diagnostic Laboratory — Backend

A lightweight, self-hosted lab management API for a small diagnostic laboratory.
Built with **Node.js + Express + Prisma + SQLite**. No external database server
required — the entire database lives in a single file.

---

## Table of Contents

- [Features](#features)
- [Tech Stack](#tech-stack)
- [Logo](#logo)
- [Requirements](#requirements)
- [Quick Start](#quick-start)
- [Environment Variables](#environment-variables)
- [Database](#database)
- [Running the Server](#running-the-server)
- [API Reference](#api-reference)
- [Testing](#testing)
- [Backups](#backups)
- [Production Deployment](#production-deployment)
- [Troubleshooting](#troubleshooting)
- [Project Structure](#project-structure)

---

## Features

- **Patient registry** with auto-generated IDs (`PT-1001`, `PT-1002`, …)
- **Lab visit management** — one visit groups multiple tests for a single patient
- **19-test catalog** covering CBC, Serology, Urine, and general tests
- **CBC with 20 parameters** matching the hematology analyzer output
  (WBC / RBC / PLT groups) with auto H/L flagging based on normal ranges
- **Print-ready HTML reports** — CBC on its own page, other tests combined
- **Payment tracking** per visit (Paid / Unpaid)
- **Concurrency-safe ID generation** using an atomic counter table
- **Bearer token authentication** with constant-time comparison
- **Security hardening** — 6 HTTP headers, rate limiting, body size caps
- **SQLite with WAL mode** for safe concurrent reads and writes
- **67 automated tests** (55 backend + 12 frontend) covering security, happy
  path, aggregation math, and concurrency — plus a 57-check end-to-end smoke
  run (`npm run test:smoke`) against a real booted server
- **API + static frontend in one process** — serves JSON (and print-ready HTML
  reports) plus `frontend/` as static content, so a single origin hosts the app

---

## Tech Stack

| Layer | Technology |
| :--- | :--- |
| Runtime | Node.js 20+ |
| Framework | Express 5 |
| ORM | Prisma 6 |
| Database | SQLite (WAL mode) |
| Auth | Bearer token (`API_TOKEN` env) |
| Tests | Node built-in test runner (`node --test`) |

**Zero external dependencies for auth, security, or rate limiting.**
The bearer-token gate, security headers, and rate limiter are all implemented
in-house with Node's `crypto` and `http` modules, which keeps the dependency
tree to four runtime packages.

---

## Logo

The brand mark lives at **`frontend/assets/img/logo.png`** (1254×1254 PNG, RGB,
white background) and is always referenced by the absolute path
`/assets/img/logo.png`. It appears in three places, each with a fallback when
the file is missing or cannot load:

| Where | File(s) | Fallback |
| :--- | :--- | :--- |
| App topbar (every page) | `frontend/index.html`, `frontend/pages/*.html` | `onerror` hides the image; the clinic name remains |
| Login card | `frontend/pages/login.html` | `onerror` swaps in the 🧪 emoji |
| Printed lab report + summary report | `backend/src/services/reportService.js` | Lab report swaps in its inline SVG mark; summary drops the image |

**How it is served.** `app.js` mounts `frontend/` with `express.static` *after*
the `/api/*` JSON 404 handler, so `/assets/img/logo.png` resolves on the API
origin without weakening the API. The printed reports are handed to their tab as
a `blob:` URL, which inherits the frontend origin, so the same absolute path
resolves there too. When the frontend is opened via `file://` the path cannot
resolve and the fallbacks above take over.

**Replacing the logo.** Overwrite `frontend/assets/img/logo.png` with a square
image — a circular/centered design works best because the topbar and printed
reports clip it to a circle. No code changes are needed.

---

## Requirements

- **Node.js 20 or later** — check with `node --version`
- **npm** (comes with Node.js)
- **sqlite3** (CLI tool) — optional, only for inspecting or backing up the DB
  - Ubuntu/Debian: `sudo apt install sqlite3`
  - macOS: `brew install sqlite3`

The test suite uses only Node's built-in `node:test` runner and the global
`fetch`, so it needs **no** extra tooling, test framework, or `jq`.

---

## Quick Start

```bash
# 1. Go into the project
cd backend

# 2. Install dependencies
npm install

# 3. Create your .env
cp .env.example .env
#    Edit .env and set API_TOKEN to a strong random value.
#    Generate one with:
#      node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# 4. Generate the Prisma client
npx prisma generate

# 5. Apply the existing migrations (creates the tables)
npm run db:migrate

# 6. Seed the 19-test catalog
npm run seed

# 7. Start the server
npm run dev          # development, auto-restarts on change
```

> `prisma/clinic.db` is committed as a ready-made database, so steps 4–5 are
> only needed on a fresh clone. Running `npm run seed` is idempotent and safe
> to repeat.

---

## Environment Variables

| Variable | Required | Default | Purpose |
| :--- | :--- | :--- | :--- |
| `DATABASE_URL` | yes | — | SQLite file path, relative to `prisma/`. e.g. `file:./clinic.db` |
| `PORT` | no | `5000` | Port the API listens on |
| `HOST` | no | `0.0.0.0` | Bind address. Use `127.0.0.1` to refuse external traffic |
| `API_TOKEN` | **yes** | — | Shared secret sent as `Authorization: Bearer <token>` |
| `NODE_ENV` | no | `development` | `production` trims logs and raises the rate limit |

`.env` is loaded **before** anything reads `process.env`, because
`config/db.js` builds the Prisma client at require time. `dotenv` never
overrides variables already exported, so real environment variables always win
over the file — which is how the test suite points itself at a throwaway
database.

The server **refuses to start** if `API_TOKEN` is missing or shorter than 16
characters, rather than booting a server that would reject every request.

---

## Database

SQLite in **WAL mode** with four PRAGMAs applied at startup:

| PRAGMA | Why |
| :--- | :--- |
| `journal_mode = WAL` | Readers don't block the writer |
| `busy_timeout = 10000` | Wait 10 s for a lock instead of failing instantly |
| `synchronous = NORMAL` | Safe with WAL, avoids an fsync per commit |
| `foreign_keys = ON` | SQLite defaults this **off**; cascade deletes need it |

### Schema

| Model | Purpose |
| :--- | :--- |
| `Patient` | Registry row; `patientId` is the human-facing `PT-1001` |
| `LabTest` | Catalog entry (`T001` … `T019`) with a `reportType` |
| `LabTestField` | One result row of a test, with unit + numeric normal range |
| `LabVisit` | One patient encounter, grouping several tests; `LV-1001` |
| `LabRecord` | A single test inside a visit, priced at visit time |
| `LabValue` | The entered result for one field |
| `Counter` | Atomic ID sequence — the reason IDs never duplicate |

### Concurrency

Patient and visit IDs come from a `Counter` table bumped with
`{ increment: 1 }`, which Prisma compiles to **one** atomic
`UPDATE "Counter" SET "value" = "value" + 1`. There is deliberately *no*
interactive transaction around it: on SQLite that holds the single write lock
across a whole JS round-trip and serialises every request. The previous
implementation lost 32 of 40 concurrent creates and handed out duplicate IDs.
Each create also retries up to 5 times if it catches a unique violation.

Verify with:

```bash
npm run test:concurrency     # 150 concurrent creates, expect HEALTHY
```

---

## Running the Server

```bash
npm start          # node src/server.js
npm run dev        # nodemon, restarts on file change
```

On startup it applies the PRAGMAs, validates `API_TOKEN`, and logs:

```
[server] Arham Diagnostic Laboratory API listening on http://0.0.0.0:5000
[server] env: development · health: /api/health
```

`SIGINT` (Ctrl-C) and `SIGTERM` both trigger a graceful shutdown: stop
accepting connections, drain in-flight requests, then `prisma.$disconnect()`.
This matters because killing the process mid-write can leave the WAL
un-checkpointed.

---

## API Reference

Every response uses one envelope:

```json
{ "success": true, "data": { } }          // on success
{ "success": false, "message": "..." }    // on failure
```

All routes except `/api/health` require
`Authorization: Bearer <API_TOKEN>`.

### Health

| Method | Path | Auth | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/health` | — | Liveness probe → `{ status: "ok", time }` |

### Patients

| Method | Path | Description |
| :--- | :--- | :--- |
| `GET` | `/api/patients` | List patients, each with `_count.visits` |
| `POST` | `/api/patients` | Create. Requires `name`, `age`, `gender`; optional `contact`, `address`. Returns the row with its `PT-` id |
| `GET` | `/api/patients/:id` | Fetch one patient by `patientId` |

### Catalog

| Method | Path | Description |
| :--- | :--- | :--- |
| `GET` | `/api/tests` | Full catalog, each test with its ordered `fields` |

### Visits

| Method | Path | Description |
| :--- | :--- | :--- |
| `GET` | `/api/visits` | List visits with patient + records |
| `POST` | `/api/visits` | Create. Requires `patientId` + `testCodes[]`; the total is computed server-side from the catalog |
| `GET` | `/api/visits/:id` | Fetch one visit with every record and its values |
| `PUT` | `/api/visits/:id/payment` | Set `paymentStatus` to `"Paid"` or `"Unpaid"` |
| `GET` | `/api/visits/:id/report` | **Print-ready A4 HTML** report, CBC on its own page |

### Records & results

| Method | Path | Description |
| :--- | :--- | :--- |
| `GET` | `/api/visits/records/:recordId` | One record with its test definition |
| `PUT` | `/api/visits/records/:recordId/results` | Save `{ values: [{ fieldId, value }] }`. Marks the record `Completed`, and flips the visit to `Completed` once **every** sibling record is done |

> `/visits/records/:recordId` uses a literal prefix so it can never be captured
> by the `/visits/:id` route.

### Example

```bash
TOKEN="your-api-token"
BASE="http://localhost:5000"

# Create a patient
curl -X POST "$BASE/api/patients" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"Ayesha Khan","age":34,"gender":"Female","contact":"0300-1234567"}'

# Create a visit for two tests
curl -X POST "$BASE/api/visits" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"patientId":"PT-1001","testCodes":["T001","T006"]}'

# Enter results for one record
curl -X PUT "$BASE/api/visits/records/<recordId>/results" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"values":[{"fieldId":"<fieldId>","value":"13.5"}]}'

# Save the printable report to a file
curl "$BASE/api/visits/<visitId>/report" \
  -H "Authorization: Bearer $TOKEN" -o report.html
```

---

## Testing

```bash
npm test                     # 55 tests
npm run test:smoke           # 57-check end-to-end smoke run (boots a real server)
npm run test:concurrency     # 150 concurrent creates → HEALTHY
```

55 tests across eight suites plus one standalone test, using Node's built-in
runner — no Jest, no Supertest:

| Suite | Tests | Covers |
| :--- | :--- | :--- |
| `health` | 1 | Health endpoint responds |
| `security` | 17 | Missing / wrong / malformed token, `X-Powered-By`, hardening headers, 404 shape, parser-internals leak, oversized payload, CORS allow-list, relaxed report CSP, input validation |
| `happy path` | 8 | PT- id creation, validation, visit totals, result entry, cross-test fieldId rejection, payment transitions |
| `concurrency` | 4 | 40 parallel patient creates, 30 parallel visits, concurrent result entry, duplicate-value writes |
| `reports summary` | 7 | Date validation, reversed ranges, relaxed-CSP print endpoint |
| `aggregation correctness` | 6 | LOCAL-day bucketing, zero-record visits, income math, print TOTAL row, result→complete flow |
| `input validation hardening` | 8 | Malformed payloads → 400, duplicate-code dedupe, value caps, 100kb body cap |
| `security hardening` | 3 | `no-store` on PHI, rate-limiter 429 + Retry-After, report XSS escaping |
| `reportService.test.js` | 1 | Qualitative report layout (no reference-range column) |

The suite copies `prisma/clinic.db` to a temp file and points `DATABASE_URL`
at it, so **your development data is never touched**. Those variables are set
*before* `require('./src/app')` because the Prisma client is constructed at
require time.

---

## Backups

The whole database is one file, so a backup is a copy — but only a clean one if
you include the WAL sidecars, or you silently lose every write still in the log.

**Offline backup (safest):**

```bash
cd backend/prisma
sqlite3 clinic.db ".backup 'clinic-backup.db'"
```

**Hot backup while the server is running:**

```bash
sqlite3 clinic.db "VACUUM INTO 'clinic-backup.db'"
```

**Manual copy** — stop the server first, or take all three files:

```bash
cp clinic.db      backup/clinic.db
cp clinic.db-wal  backup/clinic.db-wal     # if it exists
cp clinic.db-shm  backup/clinic.db-shm     # if it exists
```

Skipping the `-wal` file is the classic mistake: the backup opens fine but is
missing the most recent transactions.

**Restore:**

```bash
# stop the server, then:
cp backup/clinic.db backend/prisma/clinic.db
# start the server — the PRAGMAs reapply automatically
```

Schedule this with cron, and keep at least one copy **off the host** — a backup
on the same disk is not a backup.

---

## Production Deployment

1. **Rotate the token.** The `API_TOKEN` in `.env` was used during development.
   Generate a fresh one and treat the old value as compromised:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
2. **Set `NODE_ENV=production`** — quieter logs, no query warnings.
3. **Bind deliberately.** `HOST` defaults to `0.0.0.0`. Put the API behind a
   reverse proxy (nginx/Caddy) that terminates TLS, and set `HOST=127.0.0.1` so
   the app is only reachable through the proxy.
4. **Serve over HTTPS.** The bearer token is a full-access credential; over
   plain HTTP it is exposed on every request.
5. **Run as a dedicated user**, never root.
6. **Keep it alive** with systemd or `pm2` so it restarts after a crash.
7. **Back up the database** on a schedule (see above).
8. **Put the data directory on a local volume.** SQLite on a network filesystem
   (NFS, some container bind mounts) can corrupt under concurrent writes.

### systemd unit

```ini
[Unit]
Description=Arham Diagnostic Laboratory API
After=network.target

[Service]
Type=simple
User=clinic
WorkingDirectory=/opt/clinic/backend
ExecStart=/usr/bin/node src/server.js
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production
EnvironmentFile=/opt/clinic/backend/.env

[Install]
WantedBy=multi-user.target
```

### Reverse proxy (nginx)

```nginx
location /api/ {
    proxy_pass         http://127.0.0.1:5000;
    proxy_set_header   Host $host;
    proxy_set_header   X-Real-IP $remote_addr;
    proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header   X-Forwarded-Proto $scheme;
}
```

---

## Troubleshooting

| Symptom | Cause & fix |
| :--- | :--- |
| `API_TOKEN is missing or shorter than 16 characters` | Set a 16+ char `API_TOKEN` in `.env`; see `.env.example` |
| `Failed to initialise the database` | Run `npx prisma generate`, then `npm run db:migrate` |
| `PrismaClientInitializationError` | `DATABASE_URL` is wrong — it resolves relative to `prisma/` |
| `EADDRINUSE` | Port is taken: change `PORT`, or `lsof -i :5000` to find the process |
| `401 Unauthorized` on every call | Token mismatch, or the header is missing the `Bearer ` prefix |
| `429 Too many requests` | Limit is 300 req/min per IP (2000 under `NODE_ENV=test`); wait for the `Retry-After` window |
| `SQLITE_BUSY` | Another process holds the write lock. `busy_timeout` covers 10 s; beyond that, check for a second server instance |
| Duplicate IDs after a restore | The `Counter` table came from an older backup. Reset it above the highest existing ID |
| Report renders blank | The visit's records are still `Pending` — enter results first |

---

## Project Structure

```
backend/
├── src/
│   ├── server.js                  Entry point: dotenv, PRAGMAs, listen, graceful shutdown
│   ├── app.js                     Exports createApp() — one fresh stack per boot
│   ├── config/
│   │   └── db.js                  PrismaClient + WAL / foreign-key PRAGMAs
│   ├── controllers/
│   │   ├── patientController.js   Patient CRUD
│   │   └── labController.js       Tests, visits, results, report
│   ├── middleware/
│   │   ├── authMiddleware.js      Bearer gate, constant-time compare, fails closed
│   │   ├── errorMiddleware.js     Last-resort handler; hides 500 internals
│   │   ├── rateLimit.js           Per-IP windowed limiter
│   │   └── securityHeaders.js     6 hardening headers + strict CSP
│   ├── routes/
│   │   ├── patientRoutes.js
│   │   └── labRoutes.js
│   ├── services/
│   │   ├── idGeneratorService.js  Atomic PT-/LV- counters, bounded retries
│   │   └── reportService.js       Paginated A4 report HTML
│   └── utils/
│       └── apiResponse.js         The { success, data | message } envelope
├── prisma/
│   ├── schema.prisma              7 models
│   ├── clinic.db                  Development database
│   ├── seed.js                    19-test catalog
│   └── migrations/                4 applied migrations
├── scripts/
│   └── repro-concurrency.js       Concurrency verification harness
├── tests/
│   └── e2e.test.js                55 tests against a throwaway DB copy
├── .env                           Secrets — gitignored, never commit
├── .env.example                   Safe template
└── package.json
```

### Design notes

- **`app.js` exports a factory, not an app.** Tests call `createApp()` to get an
  isolated middleware stack and rate-limiter map; `server.js` is the only thing
  that listens.
- **Middleware order is deliberate.** Security headers and CORS run first so
  even 401/404/429 responses carry them; body parsing and throttling follow.
- **`/api/*` 404s answer as JSON** and never fall through to a static handler.
- **Errors never leak internals.** A 5xx returns a generic message; the real
  error is logged server-side only.

---

## License

ISC