# MKT Tools — Claude Code Instructions

## Project Overview

AI-powered social media content automation tool. Vietnamese-language product.

- **Backend**: Express.js + TypeScript, Prisma ORM, PostgreSQL, BullMQ + Redis
- **Frontend**: Single `public/index.html` (Alpine.js + Tailwind CDN) — being migrated to a separate React app by another agent
- **Realtime**: Socket.IO for live content/activity updates
- **External APIs**: Facebook Graph API, Telegram Bot, Claude/OpenAI/Gemini for AI generation

## Architecture

```
src/
├── index.ts                 # Express app entry, route mounting, server startup
├── config/index.ts          # Environment config loader
├── middleware/
│   ├── auth.ts              # JWT auth (Bearer token), login/register routes
│   └── error-handler.ts     # Global error handler
├── modules/
│   ├── campaign/            # Campaign CRUD, Excel import/parse
│   ├── content-generator/   # AI text/image generation (Claude, OpenAI, Gemini providers)
│   ├── dashboard/           # Main API: content CRUD, pages, stats, FB insights, settings, activity, revisions
│   ├── publisher/           # Facebook publishing via Graph API
│   ├── revision/            # Content revision sessions (text/image re-generation)
│   ├── settings/            # App settings stored in DB (API keys, provider configs)
│   ├── telegram-bot/        # Telegram bot for content approval workflow
│   └── workspace/           # Workspace grouping (pages → workspaces), scope resolver
├── queues/index.ts          # BullMQ job queues (content generation, publishing, scheduling)
├── realtime/index.ts        # Socket.IO server, room-based events
├── types/index.ts           # Shared TypeScript interfaces
└── utils/                   # Logger (pino), DB client, activity logging, text cleanup
```

## Key Commands

```bash
npm run dev          # Start dev server (tsx watch)
npm run build        # TypeScript compile
npm run typecheck    # Type check without emit
npm run lint         # ESLint
npm run db:migrate   # Prisma migrate dev
npm run db:generate  # Prisma generate client
npm run db:seed      # Seed database
```

## Database

PostgreSQL via Prisma. Schema at `prisma/schema.prisma`.

Key models: `User`, `Page`, `Campaign`, `ContentItem`, `ApprovalLog`, `Workspace`, `WorkspacePage`, `RevisionSession`, `ContentRevision`, `AppSetting`, `ActivityLog`

## Conventions

- Language: Vietnamese for user-facing strings, English for code/comments
- IDs: CUID (Prisma `@default(cuid())`)
- Dates: UTC in DB, displayed in `Asia/Ho_Chi_Minh` timezone
- Auth: JWT Bearer tokens, 7-day expiry
- API prefix: `/api/` for all endpoints
- Error format: `{ error: string }`
- Success format: varies by endpoint, usually JSON object or `{ success: true }`

## Agent Boundaries

- **Claude (this agent)**: Backend only — `src/`, `prisma/`, `scripts/`, config files
- **Codex (other agent)**: Frontend only — `frontend/` directory (React app, when created)
- Do NOT modify `public/index.html` — it's the legacy frontend being replaced
- Do NOT modify files in `frontend/` — that's Codex's domain
