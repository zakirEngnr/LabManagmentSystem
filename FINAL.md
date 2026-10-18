# Arham Diagnostic Laboratory — Final Report

_A lab / clinic management app: patient records, visit workflow, result entry,
printable lab reports, and a test catalog._

- **Backend:** Node.js + Express 5 + Prisma (SQLite) — REST API
- **Frontend:** Vanilla HTML/CSS/JS — no build step, no runtime dependencies
- **Auth:** Single shared bearer token (`Authorization: Bearer <token>`)
- **Tests:** Node's built-in `node:test` runner (zero test dependencies)

---

## 1. Quick start

```bash
# 1. Backend
cd backend
cp .env.example .env          # then set a real API_TOKEN (min 16 chars)
npm install
npx prisma generate
npx prisma migrate deploy
node prisma/seed.js           # load the lab test catalog
npm run dev                   # http://localhost:5000

# 2. Frontend (any static server)
cd frontend
npx serve .                   # or: python3 -m http.server 3000
# Open the frontend, log in with your API_TOKEN.
```

> The server **refuses to start / authenticate** unless `API_TOKEN` is set and is
> at least 16 characters. Generate one with:
> `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

---

## 2. Run the tests

Both suites use Node's built-in runner — nothing extra to install.

```bash
# Backend — end-to-end HTTP tests against a real Express server + SQLite
cd backend && npm test

# Frontend — logic/unit tests (XSS escaping, CBC flag logic, formatters)
cd frontend && npm test          # (or: node --test tests/)
```

### Results

| Suite     | Tests | Status |
|-----------|:-----:|:------:|
| Backend   |  55   | ✅ all pass |
| Frontend  |  12   | ✅ all pass |
| **Total** |**67** | **✅ green** |

Plus a **57-check smoke run** (`npm run test:smoke`) that boots the real server
and walks every feature end-to-end, and the 150-request concurrency harness.

---

## 3. Architecture

```
ClinicManagmentSystem/
├── backend/
│   ├── prisma/         schema.prisma, seed.js, migrations/, clinic.db (gitignored)
│   ├── scripts/        repro-concurrency.js  (defect reproduction harness)
│   └── src/
│       ├── app.js          factory: middleware stack + routes
│       ├── server.js       entry point: init DB, listen
│       ├── config/db.js    Prisma client + DB init
│       ├── middleware/     auth, securityHeaders, rateLimit, error
│       ├── routes/         patientRoutes, labRoutes, reportRoutes
│       ├── controllers/    patientController, labController, reportController
│       ├── services/       idGenerator, reportService
│       └── utils/          apiResponse helpers
├── frontend/
│   ├── index.html, pages/*.html
│   └── assets/
│       ├── js/             api, ui, auth, cbc, animations, pages/*
│       ├── css/            base, layout, components, animations
│       └── tests/          frontend.test.js
└── readme.md
```

### Data model (Prisma)

`Patient` → many `LabVisit` → many `LabRecord` → many `LabValue`;
`LabTest` → many `LabTestField`. A `Counter` table hands out atomic
patient IDs (`PT-####`) and visit numbers (`V-####`) without lost updates.

---

## 4. End-to-end test coverage

### Backend (`backend/tests/e2e.test.js`) — 55 tests

- **Health** — unauthenticated `/api/health` returns 200.
- **Auth** — every protected route returns **401** without a token, with a
  wrong token, and with a malformed `Authorization` header.
- **Patients** — create, list, get-by-id, validation, unknown id → 404.
- **Tests catalog** — list tests + fields.
- **Visits** — create (snapshots price, totals), get, payment toggle.
- **Results** — save values, reject field IDs that don't belong to the test,
  visit auto-completes when all records are done.
- **Report** — the printable HTML report returns 200 with the relaxed CSP.
- **Reports summary** — rejects unauth access; rejects invalid dates and
  ranges > 1 year; returns well-formed aggregates; swaps a reversed range;
  the `/summary/print` HTML carries the **relaxed** CSP (not `default-src
  'none'`) and still requires auth.
- **Concurrency** — 40 simultaneous patient creates → 40 unique IDs, no
  lost counter updates, no duplicate rows; 30 simultaneous visit creates →
  unique numbers; concurrent result entry; idempotent result saves.

### Frontend (`frontend/tests/frontend.test.js`) — 12 tests

Loads the **real** `ui.js` / `cbc.js` into a minimal DOM shim and asserts:

- `escapeHtml` neutralises `<script>`, `onerror=`, `&`, `"`, `'`; handles
  `null`/`undefined`/numbers.
- `badge`/`paymentBadge`/`resultBadge` escape both text **and** the CSS-kind
  argument.
- `toast()` writes `textContent`, **never** `innerHTML`.
- `fmtMoney`/`fmtDate`/`fmtTime`/`fmtDateTime` edge cases (invalid dates render
  empty, not `"Invalid Date"`).
- `getQuery` parses `?id=`.
- `computeFlag` H/L logic incl. equal-to-bounds and non-numeric inputs.
- `groupFields` partitions CBC fields and buckets leftovers.
- `isCBC`, `firstValue`, `isComplete` helpers.

---

## 5. Vulnerabilities & issues removed

| # | Issue | Severity | Fix |
|---|-------|----------|-----|
| 1 | **Open CORS** — `app.use(cors())` reflected **every** origin, so any public site could drive the API from a visitor's browser. | High | `buildCors()` allow-list: no-Origin (curl/native), `file://` (`Origin: null`), localhost/loopback, and `CORS_ORIGINS` for prod. `credentials: false`. |
| 2 | **Missing HSTS** — no `Strict-Transport-Security`, so a first visit could stay on HTTP. | Medium | Send `max-age=31536000; includeSubDomains` whenever the request is secure (HTTPS or `x-forwarded-proto: https`). |
| 3 | **Report endpoint broken by its own CSP** — the global `default-src 'none'` blocked the report's inline `<style>`/print `<script>`. | Medium | Scoped `reportCsp` on `/api/visits/:id/report` and `/api/reports/summary/print`: allows inline style/script + safe fonts, still forbids framing/objects. The JSON API keeps the strict policy. |
| 4 | **IP-spoofable rate-limit bypass** — trusting `X-Forwarded-For` blindly lets a client forge its IP. | Medium | Proxy trust is **off by default**; opt in with `TRUST_PROXY=1` (or `loopback`) only behind a trusted proxy. |
| 5 | **Thin patient input validation** — the API trusted the client form. | Low | Trust-boundary validation: length caps (name/contact/address), integer age **0–150** (`age: 0` is a valid newborn), and a gender **allow-list** (`Male`/`Female`/`Other`). |
| 6 | **Frontend rejected age 0** — `if (!age)` treated a newborn as invalid. | Low | Use `isNaN(age)` so `0` is accepted (both `patients.js` and `new-visit.js`). |
| 7 | **No frontend tests** — client logic untested. | — | Added a zero-dependency `frontend.test.js` (see §4). |
| 8 | **App crashed on boot (module-scope route)** — the reports feature mounted `app.use('/api/reports', …)` at **module top level**, where `app` is undefined → `ReferenceError` on every require. | High | Moved the mount inside `createApp()`, using an imported `reportRoutes` router. |
| 9 | **Reports summary not wired** — `reportController` imported `buildReportSummaryHTML`, but the service only exported `buildReportHTML`; the route was unreachable. | High | Exported `buildReportSummaryHTML` and mounted `/api/reports` (with `reportCsp` on the print route **before** the router). |
| 10 | **Validation errors returned 500 not 400** — `err.message.includes('date')` missed the capital-D `"Date range cannot exceed one year."`. | Low | Case-insensitive match (`toLowerCase().includes('date')`) so range errors are a clean 400. |
| 11 | **Reports bucketed by UTC day** — `toISOString()` put visits made between local midnight and UTC midnight (00:00–05:00 in UTC+5) on the PREVIOUS day, disagreeing with the frontend's local-time ranges and the dashboard's "today". | High | `toDateOnly` / `startOfDay` / `endOfDay` / `fmtDateLong` all use LOCAL calendar days; tests build ranges the same way. |
| 12 | **Print summary category table always showed "—"** — the renderer read `c.name`, but the aggregation produces `c.category`. | Medium | Render `c.category`. |
| 13 | **Print summary by-day TOTAL row ≠ its column** — the column sums PAID income only, but TOTAL printed `income.total` (paid+unpaid). | Medium | TOTAL row now prints `income.paid`. |
| 14 | **"Revenue by Test" table rendered blank names** — `reports.js` read `t.testName`; the API sends `name`. | Medium | Read `t.name`. |
| 15 | **Zero-record visits counted "Completed"** — `records.every()` is vacuously true on `[]`. | Low | Require `records.length > 0` (frontend already did). |
| 16 | **Malformed visit/result payloads → masked 500** — non-string `patientId`/`testCodes` and `values: [null]` crashed inside Prisma / `.map()`. | Medium | Type/shape validation with precise 400s; duplicate test codes now dedupe to one record; values capped (200 entries × 255 chars). |
| 17 | **No `Cache-Control` on PHI responses** — browsers/proxies were free to cache patient JSON. | Medium | `Cache-Control: no-store` on every API response. |
| 18 | **Rate limiter cleared its whole map each window** — honest in-window counts were erased and one IP could burst 2×max across the sweep boundary. | Low | Sweep only entries whose own window expired. |

### Security measures already present (verified, kept)

- **Auth:** timing-safe bearer comparison (`crypto.timingSafeEqual`); refuses
  to authenticate if `API_TOKEN` is missing/short.
- **Rate limiting:** in-house per-IP limiter (no dependency).
- **Headers:** `X-Content-Type-Options`, `X-Frame-Options: DENY`,
  `Referrer-Policy: no-referrer`, `Cross-Origin-Resource-Policy: same-site`,
  `Permissions-Policy`, and a strict `Content-Security-Policy` on the API.
- **Body limit:** JSON capped at `100kb`; `x-powered-by` disabled.
- **Error masking:** the error handler never leaks stack traces.
- **XSS (frontend):** all dynamic HTML goes through `ui.escapeHtml()` or
  `textContent`; IDs in URLs use `encodeURIComponent`.
- **Atomic IDs:** the `Counter` table prevents duplicate/lost patient IDs and
  visit numbers under concurrency.


---

## 6. Configuration reference

### Backend (`backend/.env`)

| Variable | Required | Notes |
|----------|:--------:|-------|
| `DATABASE_URL` | yes | e.g. `file:./clinic.db` |
| `PORT` | no | default `5000` |
| `API_TOKEN` | **yes** | ≥ 16 chars; all requests send it as a bearer token |
| `CORS_ORIGINS` | no | comma-separated extra origins (localhost/file always allowed) |
| `TRUST_PROXY` | no | set only behind a trusted proxy (`1`, `loopback`, …) |
| `NODE_ENV` | no | `test` raises the rate-limit ceiling for the suite |

### Frontend

No build step and **no secrets**. The only optional setting is the API base
URL, via `window.APP_CONFIG = { apiBase: "https://…" }` set before `api.js`
loads. Defaults to `http://localhost:5000`. If you set a custom origin, add it
to the backend's `CORS_ORIGINS`.

---

## 7. API reference (all protected routes need the bearer token)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/health` | unauthenticated liveness check |
| GET | `/api/patients` | list patients |
| POST | `/api/patients` | create patient |
| GET | `/api/patients/:id` | patient detail + visit history |
| GET | `/api/tests` | test catalog |
| GET | `/api/visits` | list visits |
| POST | `/api/visits` | create visit |
| GET | `/api/visits/:id` | visit detail |
| PUT | `/api/visits/:id/payment` | mark paid/unpaid |
| GET | `/api/visits/records/:recordId` | one record |
| PUT | `/api/visits/records/:recordId/results` | save results |
| GET | `/api/visits/:id/report` | printable HTML report |
| GET | `/api/reports/summary?from=&to=` | daily/weekly/monthly income & visit aggregates |
| GET | `/api/reports/summary/print?from=&to=` | printable HTML summary |

---

## 8. Status

✅ **End-to-end tested** — backend (HTTP + concurrency + reports) and frontend
(logic). Reproduce the concurrency guarantees any time with
`node scripts/repro-concurrency.js`.
✅ **Vulnerabilities removed** — CORS locked down, HSTS added, report CSP
scoped, proxy-trust hardening, server-side input validation, age-0 bug fixed,
and the reports feature wired so the app boots cleanly.
✅ **All 67 tests passing** (55 backend + 12 frontend), plus a 57-check
end-to-end smoke run (`npm run test:smoke`) and the 150-request concurrency
harness (`npm run test:concurrency` → HEALTHY).

