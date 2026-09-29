# ReachInbox Email Scheduler

> Phase 6: complete frontend application (dashboard, compose, search, Slack UI) + sender/bulk backend endpoints.

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
npm install
npm run prisma:migrate
npm run dev                  # http://localhost:4000/api/health

# 3. Worker (new terminal — required for emails to actually send)
cd backend
npm run worker:dev

# 4. Frontend (new terminal)
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
| `ETHEREAL_HOST` / `ETHEREAL_PORT` / `ETHEREAL_USER` / `ETHEREAL_PASSWORD` / `ETHEREAL_FROM` | Ethereal SMTP (see below) |
| `WORKER_CONCURRENCY` (default 5) / `MAX_ATTEMPTS` (default 3) | worker concurrency, BullMQ attempts |

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
- `POST /api/emails/schedule` (auth) → `{ id, status, recipient, subject, scheduledAt, bullmqJobId, delayMs }` (201)
- `GET /api/emails/scheduled` (auth) → own `SCHEDULED`+`PROCESSING` emails, `scheduledAt` ascending
- `GET /api/emails/sent` (auth) → own `SENT` emails, `sentAt` descending
- `GET /api/emails/:id` (auth) → own email detail or `404 EMAIL_NOT_FOUND`
- `GET /api/emails/search?q=` (auth) → own emails matching recipient/subject/body/sender (Elasticsearch)
- `GET /api/slack/connect` (auth) → 302 to Slack OAuth (or `503 SLACK_NOT_CONFIGURED`)
- `GET /api/slack/callback` (auth) → stores connection, 302 to `/dashboard?slack=connected|error`
- `GET /api/slack/status` (auth) → `{ connected, teamName }` (never the token)
- `POST /api/slack/disconnect` (auth) → removes the connection
- `GET /admin/queues/` → Bull Board (auth + `BULL_BOARD_ADMIN_EMAIL` only; 404 when unconfigured)
- `GET /api/senders` (auth) → own senders `{ id, email, name, hourlyLimit }`
- `POST /api/senders` (auth) → create sender (email unique per user; 409 `SENDER_EXISTS`)
- `POST /api/emails/schedule/bulk` (auth) → one campaign + staggered jobs; `{ campaignId, totalRecipients, scheduled, failed, duplicatesRemoved, startTime, status }` (201, max 1000 recipients)

## Email scheduling architecture (Phase 4)

```
Express API → PostgreSQL ScheduledEmail (SCHEDULED)
            → BullMQ delayed job { emailId } → Redis (persistent, AOF)
BullMQ Worker → claim SCHEDULED → PROCESSING (atomic conditional UPDATE)
              → Ethereal SMTP → SENT (+sentAt) / FAILED (+errorMessage)
```

Why BullMQ delayed jobs instead of cron: each email is an individual
durable job in Redis — no timers in process memory, no polling loops, no
startup rescheduling. A delayed job fires once at the right time even if the
API and worker both restarted in between. Concurrency (`WORKER_CONCURRENCY`),
retries (3 attempts, exponential backoff 5s/10s/20s) and bounded history
(`removeOnComplete`/`removeOnFail` caps) are all BullMQ-native.

- **Database is source of truth.** Jobs carry only `{ emailId }`; every send
  decision re-reads PostgreSQL. No email content in Redis.
- **Deterministic job ids** (`email-<uuid>`, unique `bullmqJobId`): the same
  row can never produce two queue jobs.
- **Idempotency:** atomic `SCHEDULED → PROCESSING` claim (exactly one worker
  wins); `SENT`/`FAILED` rows are never resent; missing rows complete
  silently. A `PROCESSING` row seen by a fresh delivery is retried later if a
  live worker owns it, or recovered if the claim is stale (crashed worker).
- **Restart behavior:** nothing is recreated on boot. Delayed jobs stay in
  Redis; the worker just consumes them. Verified: worker killed before due
  time → job remained delayed → restarted worker sent it → `SENT`.
- **Ethereal preview URLs:** logged by the worker (`email sent via ethereal`)
  and safe to open (fake inbox). SMTP passwords never logged; error messages
  are truncated and password-redacted before storage.
- **Honest limitation (at-least-once, not exactly-once):** if SMTP accepts the
  message and the worker crashes before writing `SENT`, the retry cannot know
  the first send happened and may deliver twice. Concurrent duplicates are
  prevented via claim + live-claim detection, but the SMTP-accepted/crash
  window is inherent to any system without provider-side dedup.

## Ethereal setup (local)

1. Create a free account at https://ethereal.email (or run
   `nodemailer.createTestAccount()` once) to get SMTP credentials.
2. Put them in `backend/.env` (never commit):
   ```
   ETHEREAL_HOST=smtp.ethereal.email
   ETHEREAL_PORT=587
   ETHEREAL_USER=...@ethereal.email
   ETHEREAL_PASSWORD=...
   ```
3. Start API + worker, schedule via `POST /api/emails/schedule`, watch the
   worker log for the preview URL, open it to see the delivered message.

## DB ↔ queue consistency window

PostgreSQL and Redis cannot commit atomically. Order is DB-first (row +
campaign in one Prisma transaction), then enqueue, then persist `bullmqJobId`.
If persisting the job id fails, the just-created job is removed best-effort so
a row the API reported as failed can never be sent. Each `POST /schedule`
creates a new logical email (no client idempotency key in Phase 4) — do not
blindly retry 500s.

## Distributed rate limiting + minimum delay (Phase 5)

One atomic Lua script per send attempt (`src/services/send-reservation.service.ts`):

- Keys: `email:throttle:{senderId}` (next-allowed epoch ms) and
  `email:rate:{senderId}:{YYYY-MM-DDTHH}` (reserved sends in that UTC hour).
- The script computes `sendAt = max(now, throttle)`, picks the hour bucket
  containing `sendAt`, rejects when full (`RATE_LIMIT`, retry at next hour
  boundary), else increments the bucket and advances the throttle. No
  check-then-set race across any number of workers/instances; no in-memory
  state, so restarts change nothing (verified: counters read back over a fresh
  connection).
- Reservation happens BEFORE SMTP (conservative: a crash after reserving
  under-sends, never over-sends). Failed SMTP sends do not refund capacity.
- `MIN_SEND_DELAY_MS` (default 2000) is global per sender in this phase.

### Rescheduling (no sleep, no polling, no retries consumed)

When the slot is in the future or the hour is full, the worker creates a
replacement delayed job (`email-<uuid>-<slotMs>`, distinct ids per slot so
completed-job history never collides), flips the row `PROCESSING → SCHEDULED`
with the new `scheduledAt`/`bullmqJobId`, and completes the current job
successfully. The replacement re-fires at the slot and re-runs reservation.
Only replacement jobs (`reserved: true`) may send on a matured slot — initial
jobs always bid, so bursts serialize instead of sending at once, and
throttle leapfrog can never livelock (found + fixed live in this phase).

### Ordering

Slots are reserved monotonically per sender and `scheduledAt` tracks the slot,
so order is preserved in the common case. Strict global ordering is NOT
guaranteed under concurrency (documented limitation).

## Slack integration (Phase 5)

- OAuth: `GET /api/slack/connect` stores an unguessable `state` in the
  server session and 302s to Slack (`chat:write,im:write,users:read` — minimum
  for DMing the user). The callback validates `state` (timing-safe) and uses
  the session identity — never a query-param user id — then upserts one
  `SlackConnection` per user (reconnect replaces).
- Rate-limit alerts: DM via `conversations.open` + `chat.postMessage` with
  sender, limit, UTC hour, next window, pending count. Idempotent per
  sender+hour via atomic `SET … NX EX` (`slack:alert:{senderId}:{hour}`) — 10
  simultaneous workers produce 1 message. Sending never throws: unconnected
  workspace or Slack outage only logs; email flow always continues.

## Elasticsearch (Phase 5)

Index `reachinbox-emails` (mapping in `src/lib/elasticsearch.ts`; created
lazily, never at boot). Documents are upserted on scheduled/sent/failed/
rescheduled via a never-throwing wrapper (also guarded inside the worker), so
an ES outage cannot fail email. PostgreSQL stays the source of truth
(eventual consistency). `GET /api/emails/search` runs a real `multi_match`
(recipient^3, subject^2, body, senderEmail^2) always filtered by `userId`.

## Bull Board (Phase 5)

`GET /admin/queues/` serves the live `email-send` board. Always behind
`requireAuth`; if `BULL_BOARD_ADMIN_EMAIL` is unset the route is 404 (never
public by default); if set, only that user gets 200, others 403.

## Known failure windows (Phase 5 additions)

- Reservation before SMTP + crash → capacity consumed without sending
  (under-send by design).
- SMTP accepted + crash before `SENT` → retry may duplicate (at-least-once).
- ES is eventually consistent; Slack alerts are best-effort.
- `MIN_SEND_DELAY_MS` is assumed ≪ 1h (slots always fall in the current or
  next UTC hour bucket).

## Frontend application (Phase 6)

Routes (all `/dashboard/*` protected; `/login` redirects away when authenticated):

- `/login` — Google OAuth entry, backend error messages
- `/dashboard` — overview cards (scheduled/sent/senders/Slack) derived from
  live queries, next-up list, Slack callback toasts
- `/dashboard/scheduled`, `/dashboard/sent` — tables with status badges,
  detail modal (`GET /api/emails/:id`), loading/empty/error states
- `/dashboard/compose` — sender select + inline sender creation, manual or
  CSV/TXT recipients with live valid/invalid/duplicate counts, subject/body,
  local-time start, delay presets (2s–1min + custom ms), read-only sender
  hourly limit, result panel + scheduled-list invalidation
- `/dashboard/search` — debounced (400ms) Elasticsearch search
- `/dashboard/slack` — connect/disconnect, team name, no tokens in UI

Notes:

- Bulk scheduling (`POST /api/emails/schedule/bulk`, max 1000) creates one
  campaign with staggered slots; duplicates are removed and counted. The
  sender's `hourlyLimit` is always enforced server-side.
- CSV: header-aware email-column detection (else most email-like column);
  quoted commas supported. TXT/manual: one address per line, commas/semicolons
  also split. Parsing is local; only validated addresses are submitted.
- Auth is cookie-session based; nothing secret touches localStorage. Server
  state lives in TanStack Query with retries capped and 15s stale time.
- No Figma assets exist in the repo, so styling is an original clean SaaS
  design (Tailwind, responsive sidebar → hamburger under `md`, scrollable
  tables). Not visually verified in a real browser in this environment.

## Verification

- Backend: `cd backend; npm run typecheck; npm run lint; npm run build; npm test`
- Frontend: `cd frontend; npm run typecheck; npm run lint; npm run build; npm test`
- DB: `cd backend; npm run prisma:migrate; npm run db:check`
- Tests use real PostgreSQL/Redis/Elasticsearch and isolated BullMQ queues
  per test file (`EMAIL_QUEUE_NAME` override) so parallel suites can't steal
  each other's jobs.
