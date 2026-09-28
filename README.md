# ReachInbox Email Scheduler

> Phase 1 scaffold. Later phases add Prisma, Google/Slack OAuth, BullMQ, Ethereal sending, Elasticsearch, Bull Board, full dashboard, tests.

## Architecture (Phase 1)

```
React (Vite) → Express API → health check → Redis / PostgreSQL ping
```

Full target architecture (later phases):

```
Frontend → Express API → PostgreSQL (source of truth)
                        → BullMQ delayed jobs → Redis
BullMQ Worker → Redis + PostgreSQL → Ethereal SMTP
Email → Elasticsearch index
Rate limit → Redis atomic counter → reschedule + Slack alert
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

See `.env.example`. Phase 1 uses only:

| Var | Purpose | Default |
|-----|---------|---------|
| `NODE_ENV` | env mode | `development` |
| `PORT` | backend port | `4000` |
| `FRONTEND_URL` | CORS origin | `http://localhost:5173` |
| `DATABASE_URL` | postgres ping | local compose URL |
| `REDIS_URL` | redis ping | `redis://localhost:6379` |
| `SESSION_SECRET` | (Phase 3) | — |

Remaining vars (Google/Slack/Ethereal/ES/worker) are placeholders for later phases.

## API (Phase 1)

- `GET /api/health` → `{ status: "ok", redis: "connected"|"disconnected", database: "connected"|"disconnected" }`

## Verification

- Backend typecheck: `cd backend; npm run typecheck`
- Frontend typecheck: `cd frontend; npm run typecheck`
