# CoinScan

CoinScan is a full-stack web application for identifying coins and banknotes. Upload an image (file upload or simulated camera) and a Google Gemini–powered analysis returns an identification with an honest authenticity assessment — including a clear "unable to verify" outcome instead of a guaranteed verdict. The app includes a chatbot assistant, user authentication, per-user scan history, a collection manager, a currency converter, and a contact form, with all user data persisted in MySQL.

## Features

- **Coin & currency identification** — upload an image or use the camera flow; the backend analyzes it with Gemini and returns identification results with authenticity status (`LIKELY_GENUINE`, `SUSPICIOUS`, `LIKELY_COUNTERFEIT`, `UNABLE_TO_VERIFY`).
- **Gemini AI image analysis** — server-side integration with Google Gemini (free-tier model only; models outside the verified free allowlist are refused at startup).
- **Chatbot** — an AI assistant scoped to the CoinScan domain (off-topic questions are rejected) with per-user conversations stored in MySQL, including image attachments.
- **Authentication** — signup/login/logout with JWT sessions. Passwords are hashed with PBKDF2-SHA256 (stdlib, 210,000 iterations); tokens are signed with PyJWT and restored on page reload via `GET /api/auth/me`.
- **Per-user data isolation** — every scan, collection item, chat, message, and image is stored under the authenticated user's id and fetched with queries scoped to that id (see [Authentication & data isolation](#authentication--data-isolation)).
- **MySQL persistence** — users, chats, messages, scan history, collection items, uploaded images (BLOBs), and contact messages.
- **Upload History** — every identification is saved per user and listed on the History page, with reopen/delete/clear actions.
- **Collection** — save coins/notes to a personal collection with favorites and images, synced to the server per account.
- **Currency converter** — interactive conversion page for supported currencies.
- **Contact form** — messages are always saved to MySQL first; optional SMTP email delivery to the team inbox (real delivery requires SMTP credentials — see [Contact email delivery](#contact-email-delivery)).

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React + Vite, Tailwind CSS, react-router-dom, lucide-react |
| Backend | Python, FastAPI, Uvicorn |
| Database | MySQL (PyMySQL), schema in `backend/schema.sql` |
| AI | Google Gemini (`google-genai` SDK), free-tier model `gemini-3.5-flash-lite` (default) |
| Auth | JWT (PyJWT) |
| Tests | Playwright (end-to-end), Python test suites |

## Project structure

```
CoinScan/
├── backend/                 # FastAPI application (runs on port 8000)
│   ├── main.py              # App entry: CORS, routers, /api/health, production guards
│   ├── config.py            # Environment variables (loads backend/.env)
│   ├── db.py                # MySQL connection helpers
│   ├── schema.sql           # Database schema (creates DB + all tables)
│   ├── auth.py              # Signup / login / logout / me endpoints
│   ├── security.py          # Password hashing + JWT signing/verification
│   ├── deps.py              # Auth dependencies for protected routes
│   ├── contact.py           # Contact form endpoint
│   ├── userdata.py          # Scan history, collection, chats, images endpoints
│   ├── ai.py                # Gemini client, prompts, free-model allowlist
│   ├── requirements.txt     # Python dependencies
│   ├── migrations/          # Idempotent SQL migrations for existing databases
│   └── .env.example         # Template for backend/.env (copy, then fill in)
├── src/                     # React frontend (Vite dev server on port 5173)
│   ├── App.jsx, main.jsx    # App shell and routes
│   ├── api.js               # Backend API client (base URL: /api via Vite proxy)
│   ├── pages/               # Landing, Login, Signup, Home, History, Collection,
│   │                        # Chatbot, Contact, CurrencyConverter, IdentificationResult
│   ├── components/          # UI components
│   ├── context/             # Auth, Collection, Theme contexts
│   ├── data/                # Static coin/currency/rarity data
│   └── bg/, index.css       # Assets and styles
├── public/                  # Static files (favicon)
├── tests/                   # Playwright specs (*.spec.js) + Python suites
│   ├── fixtures/            # Test images and fake-camera video (required)
│   ├── servers/             # Fake Gemini upstream + SMTP capture for tests
│   ├── dbcheck.py           # MySQL verification CLI used by specs
│   └── benchmark_gemini_10.py  # Optional 10-image authenticity benchmark
├── index.html               # Vite entry
├── package.json             # Scripts and frontend dependencies
├── vite.config.js           # Vite config: port 5173, /api proxy → :8000
├── playwright.config.js     # E2E config: auto-starts frontend + backend
└── .env.example             # Optional frontend VITE_BACKEND_URL template
```

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node.js | **20.19+ or 22.12+** (tested on Node 24) | Vite 8 requires it — see `vite` engines field |
| npm | 10+ (tested on 11) | `package-lock.json` is committed, so `npm ci` works |
| Python | **3.10+** (tested on 3.14) | `pip` available |
| MySQL | 8.x (or compatible MariaDB) | local server or remote |
| Git | any recent version | |

Feature credentials:

- **Google Gemini API key** (free tier: [Google AI Studio](https://aistudio.google.com/apikey)) — needed for coin/note identification, the chatbot, and the live AI test suites. Without it the app still runs: auth, Upload History, Collection, Currency Converter, and the Contact form all work; only AI responses report "not configured".
- **SMTP credentials** (`SMTP_USER` + `SMTP_PASSWORD` + `CONTACT_TO`) — only for real Contact-form email delivery. Without them messages are still saved to MySQL.
- Playwright's Chromium browser — once, for end-to-end tests: `npx playwright install chromium`.

## Setup

Each teammate works in **their own environment**: their own clone, their own `backend/.env`, their own MySQL schema, their own `JWT_SECRET`, and their own Gemini key. Never commit `.env` files — they are git-ignored.

### 1. Clone the repository

```bash
git clone https://github.com/raunakshukla15/Coin-Currency_Detector-Recogniton.git
cd Coin-Currency_Detector-Recogniton
```

### 2. Frontend setup

```bash
npm ci          # clean install from package-lock.json (preferred)
# or: npm install
```

### 3. Backend setup

```bash
python -m venv .venv
# Windows:   .venv\Scripts\activate
# macOS/Linux: source .venv/bin/activate
pip install -r backend/requirements.txt
```

(Any Python environment works as long as `backend/requirements.txt` is installed — a venv keeps your system Python clean.)

### 4. Configure `backend/.env`

Copy the template, then fill in your values:

```bash
cp backend/.env.example backend/.env     # Windows: copy backend\.env.example backend\.env
```

`backend/.env` variables (names only — see `backend/.env.example` for placeholders):

| Variable | Needed | Purpose |
|---|---|---|
| `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_DATABASE` | **Required** | MySQL connection (defaults target a local server, database `coinscan`) |
| `JWT_SECRET` | **Required** | Signs access tokens — generate your own per machine, e.g. `python -c "import secrets; print(secrets.token_hex(32))"` (≥ 32 chars; production refuses weak/default values) |
| `GEMINI_API_KEY` | **Required for AI features** (identify, chatbot, live AI tests) | **Google Gemini key — server-side only** |
| `JWT_EXPIRES_DAYS` | Optional | Token lifetime in days (default 7) |
| `APP_ENV` | Optional | `development` (default) or `production` |
| `CORS_ORIGINS` | Optional | Comma-separated allowed browser origins (default: local Vite dev server) |
| `GEMINI_MODEL` | Optional | Leave unset to use the default free-tier model |
| `GEMINI_API_URL` | Tests only | Proxy override — leave unset in normal use |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `CONTACT_TO`, `SMTP_STARTTLS` | Optional (real email delivery) | Contact-form email delivery; without `SMTP_USER`/`SMTP_PASSWORD` messages are saved but not emailed |

> **Security — `GEMINI_API_KEY` belongs ONLY in `backend/.env`.**
> `backend/.env` is git-ignored and must never be committed. The key is read exclusively by the backend (`config.py` → `ai.py`) and is never sent to the browser. Never prefix it with `VITE_`, never place it in the frontend, and never paste it into source files or `.env.example`.

### 5. Create the MySQL database

**Fresh clone (all teammates):** the schema creates the database (`coinscan`) and all tables itself — this is the only database step you need:

```bash
mysql -u root -p < backend/schema.sql
```

(or run the file from MySQL Workbench / your client). Tables: `users`, `contact_messages`, `user_images`, `chats`, `chat_messages`, `scan_history`, `collection_items`. Uploaded images are stored as `LONGBLOB` columns inside MySQL. To use a different database name, edit the `CREATE DATABASE`/`USE` lines in `schema.sql` and set `MYSQL_DATABASE` in `backend/.env` to match.

**Existing database (upgrade only):** if your database predates the contact-feedback linkage change, additionally apply the idempotent migration once (adds `contact_messages.user_id`, `contact_messages.submission_id`, the `fk_contact_user` foreign key, uniqueness/lookup indexes — no rows are modified or deleted):

```bash
mysql -u root -p coinscan < backend/migrations/001_contact_feedback_linkage.sql
```

Order: `schema.sql` first (or already applied), then `migrations/001_contact_feedback_linkage.sql`. Never re-run migrations against a database you did not create just to "check" them — they are idempotent, but your data is your data.

### 6. Start the backend

```bash
cd backend
python -m uvicorn main:app --host 127.0.0.1 --port 8000
```

Health check: `http://127.0.0.1:8000/api/health`

### 7. Start the frontend

```bash
npm run dev
```

Open **http://localhost:5173**. In development the Vite proxy forwards `/api` → `http://localhost:8000`, so no extra frontend configuration is needed.

Other scripts:

```bash
npm run build      # production build → dist/
npm run preview    # preview the production build
```

## Authentication & data isolation

- **Identity comes from the token.** Every protected endpoint resolves the caller from the Bearer JWT (`backend/deps.py`); request bodies and query strings can never supply a `user_id`. The contact endpoint uses an optional-token dependency: a valid token links the message to that account, while logged-out (or expired-token) submissions are saved with `user_id = NULL` instead of being lost.
- **Every query is owner-scoped.** Scans, collection items, chats, messages, and stored images are read/written with `WHERE user_id = <token user>` (or an id + owner check). Cross-account access by id returns `404`, and unauthenticated/tampered tokens return `401`.
- **Frontend state is account-scoped too.** On logout and on every identity change the app clears the previous account's state synchronously (collection, upload history, chats, page-session previews) and guards in-flight requests with stale-response checks, so a delayed response from the previous account can never repaint the current one. Security never depends on this filtering — the backend enforces ownership regardless.
- **After rotating `JWT_SECRET`** (including the first time you replace the development default), all previously issued tokens become invalid: every user must log in again. This is expected and is not a data loss — nothing server-side is deleted.

## Recognition workflow (Gemini integration)

1. The frontend downscales the image client-side and posts it to `POST /api/ai/identify` (authenticated).
2. The backend calls Google Gemini server-side with a recognition prompt (identify every coin/note + factual observations) and a separate observation-based authenticity step. The Gemini key never reaches the browser.
3. Authenticity (`LIKELY_GENUINE` / `SUSPICIOUS` / `LIKELY_COUNTERFEIT` / `UNABLE_TO_VERIFY`) is only produced from image analysis; without an image it stays `null` and is shown as "unable to verify" — nothing is invented from filenames or match percentages. Overlays/watermarks never decide the verdict.
4. The result page shows the outcome; saving posts it to `POST /api/scans`, which stores the items, authenticity verdict, and image under the signed-in user's id (Upload History).
5. Only models in the verified **free-tier allowlist** (`backend/ai.py`) are accepted; anything else is refused at startup so a paid model can't be configured by accident.

## Contact email delivery

- Contact submissions are **always saved to MySQL first**; a later SMTP failure can never lose a message, and the UI reports "saved" and "emailed" separately and honestly.
- **Real external email delivery requires SMTP credentials**: set `SMTP_USER` and `SMTP_PASSWORD` (e.g. a Gmail address + App Password) plus `CONTACT_TO` (the team inbox) in `backend/.env`, then restart the backend. Without them the backend skips sending and marks the message `not_configured`.
- The contact details displayed on the Contact page are placeholders (`CONTACT_INFO` at the top of `src/pages/Contact.jsx`) — replace them with your team's public contact details.
- The Python contact tests exercise this flow through a **local SMTP capture server (offline)** — they verify the code path, not delivery to a real inbox. External delivery has not been verified end-to-end here and depends on your SMTP provider.

## Tests

### End-to-end (Playwright)

```bash
npm run test:e2e
```

- Runs all `tests/*.spec.js` specs (app smoke, auth, scan, camera with fake webcam, chat, chat-domain, collection, account-switch isolation including the History/Chatbot pages, contact, persistence, buttons, responsive, error handling).
- Prerequisites: MySQL running with the schema applied, `backend/.env` configured, dependencies installed for both sides, and browsers installed once via `npx playwright install chromium`.
- The Playwright config automatically starts the Vite dev server (`:5173`) and the backend (`:8000`) if they are not already running.

### Python suites

Each suite is standalone — run it directly:

```bash
python tests/test_ai_failures.py          # AI error handling against a fake upstream (offline)
python tests/test_gemini_free.py          # free-tier model/config checks (add GEMINI_FREE_TEST_LIVE=1 for live API checks)
python tests/test_contact_smtp.py         # contact email flow via a local SMTP capture (offline)
python tests/test_account_isolation.py    # 4-account ownership/leak checks (collection, scans, chats, images, contact linkage)
python tests/test_chat_domain.py          # chatbot domain/off-topic policy checks
python tests/test_overlay_authenticity.py # authenticity/annotation checks (uses live Gemini calls)
```

Suites print `RESULT: n/n passed`. Suites that exercise the live model require a valid `GEMINI_API_KEY` in `backend/.env`.

### Optional utilities

```bash
python tests/benchmark_gemini_10.py       # 10-image authenticity benchmark (live Gemini; writes tests/benchmark_results.json, git-ignored)
python tests/dbcheck.py ping              # MySQL verification CLI (also: contacts, scans, collection, user, ...)
```

## Production deployment

Set these when deploying (they are environment configuration, not code changes):

1. **`APP_ENV=production`** — enables startup guardrails.
2. **`JWT_SECRET`** — a long random string (≥ 32 chars). Production refuses to start with the default/weak placeholder.
3. **`GEMINI_API_KEY`** — required; production refuses to start without it. The model must remain a verified free-tier model (`GEMINI_MODEL` — anything else is refused at startup, so no paid model can be configured by accident).
4. **Production MySQL** — a managed/hosted MySQL with `backend/schema.sql` applied, plus `MYSQL_*` credentials in the backend environment.
5. **`CORS_ORIGINS`** — set to your real frontend origin(s) (the default only allows the local dev server).
6. **Frontend backend URL** — build with `VITE_BACKEND_URL` set to your API origin (set at **build time**), or serve `dist/` behind the same origin as the API and reverse-proxy `/api` to the backend. The dev proxy exists only in `vite dev`.
7. **HTTPS** — terminate TLS at your reverse proxy / hosting platform.
8. **Persistent storage** — uploaded images are stored as blobs inside MySQL (`user_images`), so the database volume must be persistent and backed up; it grows with uploads.
9. **Optional SMTP** — set `SMTP_*` + `CONTACT_TO` if you want Contact-form emails delivered (messages are stored in MySQL either way).

The backend itself makes no localhost assumptions — it only needs these environment variables.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Backend exits: *"Refusing to start in production with a default/weak JWT_SECRET"* | Set a real `JWT_SECRET` (≥ 32 chars) in `backend/.env`. |
| Backend exits: *"Refusing to start in production without GEMINI_API_KEY"* | Add `GEMINI_API_KEY` to `backend/.env`. |
| Backend exits mentioning the model / free allowlist | Keep `GEMINI_MODEL` unset or on the default free-tier model. |
| AI endpoints report *"The AI service is not configured on the server (missing GEMINI_API_KEY)"* | Add the key to `backend/.env` and restart the backend. |
| Errors like table missing / `doesn't exist` | Apply the schema: `mysql -u root -p < backend/schema.sql`. |
| Frontend cannot reach the API (`Failed to fetch`) | Ensure the backend is running on port `8000` (dev proxy forwards `/api` there). |
| Browser CORS errors in production | Set `CORS_ORIGINS` to the exact frontend origin (scheme + host, no trailing slash). |
| `EADDRINUSE` / port in use | Ports `5173` (frontend) or `8000` (backend) are taken — stop the other process. |
| Playwright: browser executable missing | Run `npx playwright install chromium`. |
| Playwright DB-dependent specs fail | Start MySQL, apply `schema.sql`, and confirm `backend/.env` exists (the config auto-starts both servers). |
| MySQL `Access denied` / wrong credentials | Set `MYSQL_USER` / `MYSQL_PASSWORD` (and `MYSQL_HOST`/`MYSQL_PORT` if remote) in `backend/.env` and restart. |
| Everyone logged out / `401 Invalid or expired session` after a deploy | Expected after rotating `JWT_SECRET` — users just need to log in again (no data is lost). |
| AI endpoints return `502` with a rate-limit or quota message | Free-tier Gemini limits apply — wait a moment and retry; check the backend log for the sanitized reason. |
| API returns `401` on protected routes while logged in | Token expired or secret rotated — log out and log in again. |
| Contact form succeeds but no email arrives | SMTP is optional: without `SMTP_USER`/`SMTP_PASSWORD` the message is still saved in MySQL (marked as not configured). For real delivery set `SMTP_USER` (Gmail address), `SMTP_PASSWORD` (App Password), and `CONTACT_TO`, then restart the backend. |
