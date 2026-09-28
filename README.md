# ReachInbox Email Scheduler

> Phase 3: real Google OAuth + PG-backed sessions. Later phases add BullMQ, Ethereal sending, Slack, Elasticsearch, email dashboard.

## Architecture

```
React (Vite) → Express API → PostgreSQL (source of truth: users, sessions)
```

Full target architecture (later phases):

```
Frontend → Express API → PostgreSQL (source of truth)
                        → BullMQ delayed jobs → Redis
BullMQ Worker → Redis + PostgreSQL → Ethereal SMTP
Email → Elasticsearch index
Rate limit → Redis atomic counter → reschedule + Slack alert
```

Auth flow (Phase 3):

```
Browser → GET /api/auth/google → Google consent → callback
→ upsert User by googleId → regenerate session, store userId in PG "session" table
→ 302 to /dashboard (HTTP-only cookie)
```

## Prerequisites

- Node.js 22+
- Docker + Docker Compose (for postgres/redis/elasticsearch)
- npm

## Local setup

```powershell
# 1. Start infrastructure
docker compose up -d

# 2. Backend
cd backend
cp ../.env.example ../.env   # or copy to backend/.env — backend reads process env; root .env via dotenv
npm install
npm run dev                  # http://localhost:4000/api/health

# 3. Frontend (new terminal)
cd frontend
npm install
npm run dev                  # http://localhost:5173 (proxies /api → backend)
```

## Environment variables

See `.env.example`. Phase 3 uses:

| Var | Purpose |
|-----|---------|
| `NODE_ENV` / `PORT` / `FRONTEND_URL` | server mode, port, CORS origin + post-login redirect base |
| `DATABASE_URL` | PostgreSQL (users + `session` table) |
| `REDIS_URL` | health check (queues in later phases) |
| `SESSION_SECRET` | signs session cookies; must be a strong random value in production (server refuses to boot otherwise) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_CALLBACK_URL` | Google OAuth (see below) |

## Google OAuth setup (local)

1. Open [Google Cloud Console → APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials), create an **OAuth client ID** (type: Web application).
2. Authorized JavaScript origin: `http://localhost:5173`
3. Authorized redirect URI: `http://localhost:4000/api/auth/google/callback`
4. Copy the client ID/secret into backend env:
   ```
   GOOGLE_CLIENT_ID=...
   GOOGLE_CLIENT_SECRET=...
   GOOGLE_CALLBACK_URL=http://localhost:4000/api/auth/google/callback
   SESSION_SECRET=<long random string>
   ```
5. Start backend (`cd backend; npm run dev`) and frontend (`cd frontend; npm run dev`).
6. Visit `http://localhost:5173/login` → **Continue with Google** → consent → lands on `/dashboard` showing avatar, name, email.
7. Refresh: session persists (PostgreSQL-backed, survives backend restarts).
8. Logout → redirected to `/login`; visiting `/dashboard` redirects back to `/login`.

> Note: real Google sign-in has NOT been exercised in this environment (no
> OAuth credentials configured here); the full stack up to Google's consent
> screen plus session handling is covered by automated tests + the manual
> steps above. Without credentials, `/api/auth/google` returns
> `503 OAUTH_NOT_CONFIGURED` instead of crashing.

## Sessions

- `express-session` + `connect-pg-simple` over the `session` table (Prisma `Session` model owns the DDL; the store accesses it directly).
- Cookie `reachinbox.sid`: HTTP-only, `SameSite=lax`, `secure` in production, 7-day expiry. No tokens in localStorage; `/api/auth/me` returns only `id/name/email/avatarUrl`.
- Identity = `req.session.userId`, reloaded from PostgreSQL per request (`requireAuth`); stale sessions → 401. Session id is regenerated at login (fixation protection).

## API

- `GET /api/health` → `{ status: "ok", redis, database }`
- `GET /api/auth/google` → 302 to Google (or `503 OAUTH_NOT_CONFIGURED`)
- `GET /api/auth/google/callback` → upsert User, create session, 302 to `/dashboard` (failures → `/login?error=…`)
- `GET /api/auth/me` → `{ authenticated: true, user }` or `401 UNAUTHENTICATED`
- `POST /api/auth/logout` → `{ success: true }`, destroys session + clears cookie

## Verification

- Backend: `cd backend; npm run typecheck; npm run lint; npm run build; npm test`
- Frontend: `cd frontend; npm run typecheck; npm run lint; npm run build`
- DB: `cd backend; npm run prisma:migrate; npm run db:check`
