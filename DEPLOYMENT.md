# ReachInbox — Production Deployment

Target topology (no code rewrites; same Express API, BullMQ worker, Prisma schema):

```
Browser ──/api/*, /admin/*──▶ Vercel (frontend/dist, rewrites) ──▶ Render Web Service (backend/dist)
                                                        │                        │ ▲
                                                        │                        │ │ same Redis (Key Value)
                                                        │                        ▼ │
                                                        │              Render Background Worker
                                                        │                        │
                                                        └─ OAuth callbacks ──────┘
Render PostgreSQL ◀── DATABASE_URL ── API + Worker
External Elasticsearch ◀── ELASTICSEARCH_URL ── API + Worker
```

Key design decision: the browser **only ever talks to the Vercel domain**.
`/api/*` (and `/admin/*` for Bull Board) are proxied to Render, so session
cookies stay first-party and the existing `SameSite=Lax` + `Secure`
production cookies keep working unchanged. No JWT, no localStorage, no
`Access-Control-Allow-Origin: *`, no `sameSite: 'none'`.

## 1. Vercel — frontend (`frontend/`)

| Setting            | Value                                              |
| ------------------ | -------------------------------------------------- |
| Root Directory     | `frontend`                                         |
| Framework Preset   | Vite (auto-detected)                               |
| Build Command      | `npm run build`                                    |
| Output Directory   | `dist`                                             |
| Install Command    | default (`npm install`)                            |

Environment variable (Production + Preview as needed):

| Variable          | Example value                        | Notes                                              |
| ----------------- | ------------------------------------ | -------------------------------------------------- |
| `VITE_API_ORIGIN` | `https://reachinbox-api.onrender.com` | No trailing slash. Baked into `vercel.ts` rewrites at build time. Public (URL only, not a secret). |

Routing lives in `frontend/vercel.ts` (programmatic config — plain `config`
export, no extra dependency):

- `/api/:path*` → `${VITE_API_ORIGIN}/api/:path*` (cookies/headers proxied)
- `/admin/:path*` → `${VITE_API_ORIGIN}/admin/:path*` (Bull Board)
- `/(.*)` → `/index.html` (React Router SPA fallback; static assets in `dist/` are served before rewrites run)

Local dev is untouched: Vite dev-server proxy in `frontend/vite.config.ts`
still forwards `/api` to `http://localhost:4000`.

## 2. Render — backend Web Service (`backend/`)

| Setting          | Value                                  |
| ---------------- | -------------------------------------- |
| Root Directory   | `backend`                              |
| Runtime          | Node (≥22, see `engines`)              |
| Build Command    | `npm install && npm run build` (`prisma generate` runs inside `build`) |
| Start Command    | `npm start` (`node dist/server.js`)    |
| Health Check     | `/api/health`                          |

The app listens on `process.env.PORT` (Render injects it). No serverless
functions, no Docker needed — plain Node process.

Pre-deploy migrations (runs after build, before start — safe to re-run):

```bash
npx prisma migrate deploy
```

This is wired as `preDeployCommand` in `render.yaml`. Never run
`prisma migrate dev` against production. Do not delete `backend/prisma/migrations`.

### API environment variables

| Variable | Source on Render |
| -------- | ---------------- |
| `NODE_ENV` | `production` |
| `PORT` | injected by Render (leave unset) |
| `FRONTEND_URL` | `https://<your-vercel-domain>` (exact; used for CORS origin + post-OAuth redirects) |
| `DATABASE_URL` | linked Render PostgreSQL (`fromDatabase … connectionString`) |
| `REDIS_URL` | linked Key Value (`fromService … connectionString`, `rediss://` works with ioredis as-is) |
| `SESSION_SECRET` | generated (`generateValue`) — boot refuses the dev default in production |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | dashboard (`sync: false`) |
| `GOOGLE_CALLBACK_URL` | `https://<your-vercel-domain>/api/auth/google/callback` (**via the Vercel proxy**, not the Render domain — keeps cookies first-party) |
| `ETHEREAL_HOST/PORT/USER/PASSWORD/FROM` | dashboard secrets + public host/port/from values |
| `ELASTICSEARCH_URL` / `ELASTICSEARCH_INDEX` | external endpoint (`sync: false`) + index name |
| `SLACK_CLIENT_ID` / `SLACK_CLIENT_SECRET` | dashboard (`sync: false`) |
| `SLACK_REDIRECT_URI` | `https://<your-vercel-domain>/api/slack/callback` (via proxy, same reason) |
| `BULL_BOARD_ADMIN_EMAIL` | your email, or empty = board disabled (safe default) |

## 3. Render — background worker (`backend/`, same repo)

| Setting       | Value                          |
| ------------- | ------------------------------ |
| Type          | Background Worker              |
| Root Directory| `backend`                      |
| Build Command | `npm install && npm run build` |
| Start Command | `npm run worker` (`node dist/worker.js`) |

Same `DATABASE_URL`, `REDIS_URL`, Ethereal, Elasticsearch, Slack env as the
API (no `SESSION_SECRET` needed — the worker never signs cookies). No `PORT`
needed — it opens no HTTP server and handles `SIGTERM` gracefully
(`maxShutdownDelaySeconds: 60` lets in-flight SMTP finish). API and worker
**must** share one Redis instance (BullMQ queue state).

Tune `WORKER_CONCURRENCY` (default 5), `MAX_ATTEMPTS` (3),
`MIN_SEND_DELAY_MS` (2000) per service as needed.

## 4. Render PostgreSQL + Key Value

- **PostgreSQL**: standard instance, internal-only (`ipAllowList: []`),
  referenced via `fromDatabase … connectionString`. Prisma `datasource`
  already reads `env("DATABASE_URL")` — no code change.
- **Key Value**: `maxmemoryPolicy: noeviction` (**required** — the default
  `allkeys-lru` would silently evict delayed BullMQ jobs), `persistenceMode:
  journal-snapshot`, internal-only. Both API and worker use `REDIS_URL`
  (works for `redis://` local and `rediss://` managed TLS).

Docker Compose (`docker-compose.yml`) is untouched and remains the local
setup; deployment config coexists with it.

## 5. Manual steps (dashboard / consoles)

1. **Render**: create Blueprint from `render.yaml` (or configure the four
   resources manually per tables above); fill `sync: false` secrets;
   confirm `npx prisma migrate deploy` succeeds on first deploy.
2. **Vercel**: set Root Directory `frontend`, add `VITE_API_ORIGIN`,
   deploy. Note the `https://<app>.vercel.app` domain, then update
   `FRONTEND_URL`, `GOOGLE_CALLBACK_URL`, `SLACK_REDIRECT_URI` on Render.
3. **Google Cloud Console** → APIs & Services → Credentials → OAuth client:
   - Authorized JavaScript origin: `https://<vercel-domain>`
   - Authorized redirect URI: `https://<vercel-domain>/api/auth/google/callback`
   - Copy ID/secret into Render env. Local values keep working for dev.
4. **Slack api.slack.com/apps** → OAuth & Permissions → Redirect URL:
   `https://<vercel-domain>/api/slack/callback`. Scopes stay
   `chat:write,im:write,users:read`. Tokens remain server-side (DB only).
5. **Elasticsearch provider** (e.g. Elastic Cloud): create deployment, allow
   Render egress IPs if required, copy HTTPS endpoint + credentials into
   `ELASTICSEARCH_URL` (format `https://user:pass@host:9243`). The app creates
   the `reachinbox-emails` index lazily — a down ES never blocks boot/sending.
6. **Ethereal** (`ethereal.email`): create a test mailbox, copy SMTP user/pass
   into Render env.

## 6. Verify production

- `GET https://<render-domain>/api/health` → `{"status":"ok",…}`
- Open the Vercel app → Continue with Google → lands on dashboard.
- Compose → schedule → worker log shows Ethereal preview URL → Sent page.
- `GET https://<vercel-domain>/admin/queues/` → board (admin email only).
- Rollback: Render → manual deploy of a previous commit; worker picks up
  persisted Redis jobs (nothing is recreated on boot).

## 7. Security notes

- No `.env` committed; `render.yaml`/`vercel.ts` contain zero secrets
  (`sync: false` / dashboard only).
- `VITE_API_ORIGIN` is a public URL by design — never put tokens in `VITE_*`.
- CORS stays `origin: FRONTEND_URL` + credentials (never `*`).
- Cookies: `httpOnly`, `Secure` in production, `SameSite=Lax`,
  PostgreSQL store, 7-day expiry; `trust proxy` enabled in production.
- Google/Slack secrets live only in Render env + server memory.
