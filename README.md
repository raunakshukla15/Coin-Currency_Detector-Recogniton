# CoinScan

CoinScan is a full-stack web application for identifying coins and banknotes. Upload an image (file upload or simulated camera) and a Google Gemini–powered analysis returns an identification with an honest authenticity assessment — including a clear "unable to verify" outcome instead of a guaranteed verdict. The app includes a chatbot assistant, user authentication, per-user scan history, a collection manager, a currency converter, and a contact form, with all user data persisted in MySQL.

## Features

- **Coin & currency identification** — upload an image or use the camera flow; the backend analyzes it with Gemini and returns identification results with authenticity status (`LIKELY_GENUINE`, `SUSPICIOUS`, `LIKELY_COUNTERFEIT`, `UNABLE_TO_VERIFY`).
- **Gemini AI image analysis** — server-side integration with Google Gemini (free-tier model only; paid models are refused at startup).
- **Chatbot** — an AI assistant scoped to the CoinScan domain (off-topic questions are rejected) with per-user conversations stored in MySQL, including image attachments.
- **Authentication** — signup/login/logout with JWT-based sessions (bcrypt-style hashing via PyJWT + backend hashing, server-side sessions surviving page reloads).
- **MySQL persistence** — users, chats, messages, scan history, collection items, uploaded images (BLOBs), and contact messages.
- **Scan history** — every identification is saved per user and listed on the History page.
- **Collection** — save coins/notes to a personal collection with favorites and images.
- **Currency converter** — interactive conversion page for supported currencies.
- **Contact form** — messages are always saved to MySQL; optional SMTP delivery (email sending is not required for the form to work).

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

- **Node.js + npm**
- **Python 3.10+** (with `pip`)
- **MySQL** (local server or remote)
- A **Google Gemini API key** (free tier: [Google AI Studio](https://aistudio.google.com/apikey))
- Playwright's Chromium browser (for end-to-end tests)

## Setup

### 1. Clone the repository

```bash
git clone https://github.com/raunakshukla15/Coin-Currency_Detector-Recogniton.git
cd Coin-Currency_Detector-Recogniton
```

### 2. Frontend setup

```bash
npm install
```

### 3. Backend setup

```bash
pip install -r backend/requirements.txt
```

### 4. Configure `backend/.env`

Copy the template, then fill in your values:

```bash
cp backend/.env.example backend/.env     # Windows: copy backend\.env.example backend\.env
```

`backend/.env` supports (names only — see `backend/.env.example` for placeholders):

| Variable | Purpose |
|---|---|
| `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_DATABASE` | MySQL connection (defaults target a local server, database `coinscan`) |
| `JWT_SECRET` | Signs access tokens — must be a long random string (≥ 32 chars) outside development |
| `JWT_EXPIRES_DAYS` | Token lifetime in days (default 7) |
| `APP_ENV` | `development` (default) or `production` |
| `CORS_ORIGINS` | Comma-separated allowed browser origins (default: local Vite dev server) |
| `GEMINI_API_KEY` | **Google Gemini key — server-side only** |
| `GEMINI_MODEL` | Leave unset to use the default free-tier model |
| `GEMINI_API_URL` | Test/proxy override only — leave unset in normal use |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `CONTACT_TO`, `SMTP_STARTTLS` | Optional Contact-form email delivery |

> **Security — `GEMINI_API_KEY` belongs ONLY in `backend/.env`.**
> `backend/.env` is git-ignored and must never be committed. The key is read exclusively by the backend (`config.py` → `ai.py`) and is never sent to the browser. Never prefix it with `VITE_`, never place it in the frontend, and never paste it into source files or `.env.example`.

### 5. Create the MySQL database

The schema creates the database (`coinscan`) and all tables itself:

```bash
mysql -u root -p < backend/schema.sql
```

(or run the file from MySQL Workbench / your client). Tables: `users`, `contact_messages`, `user_images`, `chats`, `chat_messages`, `scan_history`, `collection_items`. Uploaded images are stored as `LONGBLOB` columns inside MySQL.

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

## Tests

### End-to-end (Playwright)

```bash
npm run test:e2e
```

- Runs all `tests/*.spec.js` specs (auth, scan, camera with fake webcam, chat, chat-domain, collection, contact, history persistence, buttons, responsive, error handling, smoke).
- Prerequisites: MySQL running with the schema applied, `backend/.env` configured, dependencies installed for both sides, and browsers installed once via `npx playwright install chromium`.
- The Playwright config automatically starts the Vite dev server (`:5173`) and the backend (`:8000`) if they are not already running.

### Python suites

Each suite is standalone — run it directly:

```bash
python tests/test_ai_failures.py          # AI error handling against a fake upstream (offline)
python tests/test_gemini_free.py          # free-tier model/config checks (add GEMINI_FREE_TEST_LIVE=1 for live API checks)
python tests/test_contact_smtp.py         # contact email flow via a local SMTP capture (offline)
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
| Contact form succeeds but no email arrives | SMTP is optional: without `SMTP_USER`/`SMTP_PASSWORD` the message is still saved in MySQL (marked as not emailed). |
