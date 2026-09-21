# CRM Backend

Fastify 5 + Prisma 6 + PostgreSQL backend for the CRM frontend.

## Stack

| Layer | Choice |
|---|---|
| Runtime | Node.js 22 |
| Framework | Fastify 5 |
| ORM | Prisma 6 |
| Database | PostgreSQL 16 |
| Auth | @fastify/jwt (access 15 min · refresh 7 days httpOnly cookie) |
| Validation | Zod |

## Quick start (local)

### 1. Prerequisites
- Node.js 22+
- Docker (for Postgres + Redis)

### 2. Install

```bash
npm install
```

### 3. Environment

```bash
cp .env.example .env
# Edit .env — DATABASE_URL and JWT secrets are required
```

### 4. Start Postgres (Docker)

```bash
docker compose up postgres redis -d
```

### 5. Migrate + seed

```bash
npm run db:migrate    # create tables
npm run db:seed       # load sample data
```

### 6. Run dev server

```bash
npm run dev
# API at http://localhost:3001
# Health check: GET /health
```

## Docker (full stack)

```bash
docker compose up --build
```

## API

Base URL: `http://localhost:3001/api/v1`

### Auth

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/auth/login` | — | Returns `accessToken` + sets `refreshToken` cookie |
| POST | `/auth/refresh` | cookie | Returns new `accessToken` |
| POST | `/auth/logout` | Bearer | Clears refresh cookie |

### Users

| Method | Path | Roles | Description |
|---|---|---|---|
| GET | `/users` | admin, manager | List users (search, role, status filters) |
| POST | `/users` | admin | Create user |
| GET | `/users/:id` | any | Get user |
| PATCH | `/users/:id` | admin or self | Update user |
| DELETE | `/users/:id` | admin | Delete user |
| GET | `/users/:id/stats` | any | Owned customers, deals, revenue |

### Request example

```bash
# Login
TOKEN=$(curl -s -X POST http://localhost:3001/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@crm.dev","password":"password"}' \
  | jq -r .accessToken)

# List users
curl http://localhost:3001/api/v1/users \
  -H "Authorization: Bearer $TOKEN"
```

## Project structure

```
src/
├── index.ts          — entry point
├── app.ts            — Fastify instance, plugins, routes
├── config.ts         — typed env vars
├── plugins/
│   ├── jwt.ts        — access + refresh token setup
│   └── cors.ts       — CORS
├── middleware/
│   ├── authenticate.ts  — verify Bearer token
│   └── requireRole.ts   — role-based access guard
├── lib/
│   ├── prisma.ts     — singleton PrismaClient
│   ├── password.ts   — bcrypt hash/verify + initials
│   └── errors.ts     — Prisma error → HTTP status
├── routes/
│   ├── auth.ts       — login / refresh / logout
│   └── users.ts      — user CRUD + stats
└── types/
    └── fastify.d.ts  — request.user augmentation

prisma/
├── schema.prisma     — full DB schema (all 18 models)
└── seed.ts           — sample data (5 users, customers, deals, leads, tickets)
```

## Seed accounts

All passwords: `password`

| Email | Role |
|---|---|
| admin@crm.dev | admin |
| sarah@crm.dev | manager |
| david@crm.dev | sales_agent |
| emily@crm.dev | sales_agent |
| support@crm.dev | support |

## Phase roadmap

| Phase | Status | Scope |
|---|---|---|
| 1 — Foundation | ✅ Done | Fastify scaffold, auth, user CRUD |
| 2 — Core CRM | ⬜ Next | Customers, Leads, Deals, Activities |
| 3 — Helpdesk | ⬜ | Tickets + comments |
| 4 — Files | ⬜ | S3/R2 attachment upload |
| 5 — Quotes | ⬜ | Quotes + line items |
| 6 — Tags & custom fields | ⬜ | Tag CRUD, custom field defs/values |
| 7 — Analytics & forecasting | ⬜ | Aggregation endpoints |
| 8 — Notifications | ⬜ | SSE endpoint + notification feed |
| 9 — Workflows & segments | ⬜ | Rules engine, criteria evaluator |
| 10 — Audit log & webhooks | ⬜ | Audit trail, outbound webhooks |
