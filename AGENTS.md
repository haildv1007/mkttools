# MKT Tools — Agent Instructions (for OpenAI Codex and other AI agents)

## Project Overview

AI-powered social media content automation tool for Vietnamese market.
Built with Express.js + TypeScript backend, PostgreSQL + Prisma ORM, BullMQ + Redis job queues, Socket.IO realtime.

This file documents **both frontend and backend** so any agent can work on either side.

---

## Repository Structure

```
mkttools/
├── src/                          # Backend (Express + TypeScript)
│   ├── index.ts                  # App entry: Express setup, route mounting, Socket.IO init
│   ├── config/index.ts           # Environment config loader
│   ├── middleware/
│   │   ├── auth.ts               # JWT auth middleware + auth routes (login/register/me)
│   │   └── error-handler.ts      # Global error handler
│   ├── modules/
│   │   ├── campaign/
│   │   │   ├── index.ts          # Campaign CRUD routes + Excel import
│   │   │   └── excel-parser.ts   # Excel template parsing
│   │   ├── content-generator/
│   │   │   ├── index.ts          # Provider registry (text + image)
│   │   │   └── providers/
│   │   │       ├── claude.ts         # Anthropic Claude text provider
│   │   │       ├── openai-text.ts    # OpenAI text provider
│   │   │       ├── gemini-text.ts    # Google Gemini text provider
│   │   │       ├── dalle-image.ts    # DALL-E image provider
│   │   │       └── gemini-image.ts   # Gemini image provider
│   │   ├── dashboard/index.ts    # Largest module: stats, content CRUD, bulk ops, uploads, providers, settings
│   │   ├── publisher/
│   │   │   ├── index.ts          # Publish orchestrator (platform dispatch)
│   │   │   └── providers/
│   │   │       └── facebook.ts   # Facebook Graph API v21.0 (multi-image, scheduled)
│   │   ├── revision/index.ts     # Revision sessions + execution (text/image/video)
│   │   ├── settings/index.ts     # AppSetting model (DB-first, env fallback)
│   │   ├── telegram-bot/index.ts # Telegram approval bot + revision flow
│   │   └── workspace/index.ts    # Workspace CRUD + scope resolution
│   ├── queues/index.ts           # BullMQ workers: generation, publishing, scheduler
│   ├── realtime/index.ts         # Socket.IO: rooms, events, emit helpers
│   ├── types/index.ts            # Shared TypeScript interfaces
│   └── utils/
│       ├── db.ts                 # Prisma client singleton
│       ├── logger.ts             # Pino logger
│       ├── activity.ts           # ActivityLog helpers (logActivity, updateActivity, sanitizeError)
│       └── clean-text.ts         # Text sanitization (extractCleanText)
├── prisma/
│   ├── schema.prisma             # 13 models, 8 enums
│   └── seed.ts                   # Database seeder
├── frontend/                     # React frontend (Vite + Tailwind)
├── public/                       # Static files + uploads
├── docs/API.md                   # Full API endpoint reference
├── AGENTS.md                     # This file
└── CLAUDE.md                     # Instructions for Claude Code agent
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 20+ |
| Language | TypeScript 5.6+ (strict mode) |
| Framework | Express 4 |
| ORM | Prisma 6 (PostgreSQL) |
| Queue | BullMQ 5 (Redis/IORedis) |
| Realtime | Socket.IO 4 |
| AI Text | Anthropic Claude / OpenAI / Google Gemini |
| AI Image | DALL-E / Gemini |
| Publishing | Facebook Graph API v21.0 |
| Notifications | Telegram Bot API |
| Auth | JWT (jsonwebtoken, 7-day expiry) |
| File uploads | Multer |
| Logging | Pino |
| Validation | Zod |

---

## Backend Architecture

### Entry Point (`src/index.ts`)

Express app with:
- `helmet()` with custom CSP (allows inline scripts/styles, CDN fonts, Facebook Graph, Telegram)
- `cors({ origin: '*' })` — permissive for dev
- `express-rate-limit` — 200 req/15min per IP
- `express.json({ limit: '50mb' })`
- Static serving: `public/` for uploads, `frontend/dist/` for SPA
- Route mounting order:
  1. `/api/auth` → `authRouter` (middleware/auth.ts)
  2. `/api/campaigns` → campaign module (with authMiddleware)
  3. `/api/dashboard` → dashboard module (with authMiddleware)
  4. `/api/workspaces` → workspace module (with authMiddleware)
  5. `/api/health` → health check
  6. `*` → SPA fallback (frontend/dist/index.html)
- Socket.IO init on HTTP server
- Queue workers + scheduler started on boot
- Graceful shutdown handler

### Authentication (`src/middleware/auth.ts`)

JWT-based. Token payload: `{ userId: string, role: string }`, expires in 7 days.

```typescript
// authMiddleware extracts token from "Authorization: Bearer <token>" header
// Sets req.user = { userId, role } on success
// Returns 401 if missing/invalid

// requireRole(...roles: string[]) — checks req.user.role against allowed roles
```

Auth routes:
- `POST /api/auth/login` — bcrypt compare, returns `{ token, user }`
- `POST /api/auth/register` — bcrypt hash (salt 12), default role `ADMIN`
- `GET /api/auth/me` — returns user from token

### Configuration (`src/config/index.ts`)

All config from environment variables:

```typescript
config = {
  port: number,           // PORT (default 3000)
  nodeEnv: string,        // NODE_ENV (default 'development')
  database: { url },      // DATABASE_URL (required)
  redis: { url },         // REDIS_URL (default 'redis://localhost:6379')
  ai: {
    text: { provider, anthropicApiKey, openaiApiKey, geminiApiKey, defaultModel },
    image: { provider, openaiApiKey, replicateApiKey, defaultModel },
  },
  telegram: { botToken, adminChatIds },
  facebook: { appId, appSecret },
  timezone: string,       // DEFAULT_TIMEZONE (default 'Asia/Ho_Chi_Minh')
}
```

### Settings System (`src/modules/settings/index.ts`)

DB-first configuration with env fallback. Uses `AppSetting` model (key-value store).

**19 managed keys:**
`TELEGRAM_BOT_TOKEN`, `TELEGRAM_ADMIN_CHAT_IDS`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `REPLICATE_API_KEY`, `AI_TEXT_PROVIDER`, `AI_TEXT_MODEL`, `AI_IMAGE_PROVIDER`, `AI_IMAGE_MODEL`, `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET`, `DEFAULT_TIMEZONE`, `AI_VIDEO_PROVIDER`, `AI_VIDEO_MODEL`, `KLING_API_KEY`, `MINIMAX_API_KEY`, `RUNWAY_API_KEY`, `FAL_API_KEY`

```typescript
getSetting(key)        // DB first, then process.env fallback
getSettings()          // All 19 keys merged (DB + env)
setSetting(key, value) // Upsert single
setSettings(data)      // Transaction upsert for multiple
```

The dashboard settings API masks sensitive values (starting with `••••`) on GET and skips them on PUT.

---

## Database (Prisma)

### Models (13 total)

| Model | Purpose | Key Fields |
|-------|---------|------------|
| **User** | Auth & ownership | email (unique), passwordHash, role, telegramChatId |
| **Page** | Social media page (FB/TikTok) | platform, externalId, accessToken, context, telegramGroupId |
| **Campaign** | Content grouping | pageId, genLeadTime (minutes), autoApprove |
| **ContentItem** | Core content entity | status (10 states), topic, generatedText, generatedImageUrl, generatedImages (JSON), scheduledAt, metrics (JSON) |
| **ApprovalLog** | Audit trail | action (APPROVE/REJECT/REQUEST_EDIT), feedback |
| **Workspace** | Page grouping | slug (unique, auto-generated), color, icon |
| **WorkspacePage** | M:N join (Workspace↔Page) | composite PK [workspaceId, pageId] |
| **RevisionSession** | Active revision tracking | revisionType, status (5 states), expiresAt (1hr), source (TELEGRAM/WEB) |
| **AppSetting** | Key-value config store | key (PK), value |
| **ActivityLog** | Operation audit log | action, category, status, summary, entityType/Id |
| **ContentRevision** | Version history | version (int), generatedText, generatedImages, feedback |

### Enums (8 total)

```
UserRole:       OWNER | ADMIN | VIEWER
Platform:       FACEBOOK | TIKTOK
ContentType:    IMAGE | VIDEO | TEXT
ContentStatus:  DRAFT → QUEUED → GENERATING → PENDING_REVIEW → APPROVED → PUBLISHING → PUBLISHED
                                  ↳ REVISION_REQUESTED (loops back to GENERATING)
                                  ↳ FAILED | CANCELLED
ContentSource:  AI | MANUAL | IMPORT
ApprovalAction: APPROVE | REJECT | REQUEST_EDIT
RevisionType:   TEXT | IMAGE | VIDEO | TEXT_AND_MEDIA
RevisionStatus: WAITING_FEEDBACK | PROCESSING | COMPLETED | CANCELLED | EXPIRED
```

### Content Status Flow

```
DRAFT → (scheduler picks up) → QUEUED → GENERATING → PENDING_REVIEW
                                                      ├── APPROVE → APPROVED → (scheduler) → PUBLISHING → PUBLISHED
                                                      ├── REJECT → CANCELLED
                                                      └── REQUEST_EDIT → REVISION_REQUESTED → GENERATING → PENDING_REVIEW (loop)
                                                      
Any processing stage can → FAILED (on error)
```

### Database Conventions

- All models use `@@map("snake_case_table")` for table names
- Fields use `@map("snake_case")` for column names
- IDs are `cuid()` strings
- Timestamps: `createdAt` + `updatedAt` (@updatedAt auto-managed by Prisma)
- Soft delete pattern: `isActive: Boolean @default(true)` on User and Page
- JSON fields: `generatedImages`, `selectedMediaIds`, `metrics`, `metadata` — stored as Prisma `Json?`
- Indexes on frequently queried columns: `status`, `scheduledAt`, `pageId+scheduledAt`, `createdAt`

### Prisma Usage Patterns

```typescript
import { prisma } from '../utils/db';  // singleton client

// Cursor-based pagination (used in scheduler, content listing)
const items = await prisma.contentItem.findMany({
  where: { status: 'DRAFT' },
  orderBy: { scheduledAt: 'asc' },
  take: 500,
  ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
});

// Include relations
const item = await prisma.contentItem.findUnique({
  where: { id },
  include: { page: true, campaign: true, approvalLogs: true },
});

// Transaction upsert (used in settings)
await prisma.$transaction(ops);
```

---

## AI Provider System (`src/modules/content-generator/`)

### Registry Pattern

Lazy-instantiated providers with DB setting override:

```typescript
// Provider maps — factory functions, instantiated on first use
const textProviders: Record<string, () => TextProvider> = {
  claude: () => new ClaudeTextProvider(),
  openai: () => new OpenAITextProvider(),
  gemini: () => new GeminiTextProvider(),
};

const imageProviders: Record<string, () => ImageProvider> = {
  dalle: () => new DalleImageProvider(),
  gemini: () => new GeminiImageProvider(),
};
```

**Resolution order:** DB setting (`AI_TEXT_PROVIDER` / `AI_IMAGE_PROVIDER`) → env config → default.

Cached instance is invalidated when the provider name changes (checked on every call).

### Provider Interfaces (`src/types/index.ts`)

```typescript
interface TextProvider {
  name: string;
  generate(options: TextGeneratorOptions): Promise<GeneratedContent>;
  testConnection?(): Promise<{ ok: boolean; error?: string }>;
}

interface ImageProvider {
  name: string;
  generate(options: ImageGeneratorOptions): Promise<GeneratedImage>;
  testConnection?(): Promise<{ ok: boolean; error?: string }>;
}

interface TextGeneratorOptions {
  topic: string;
  pageName: string;
  pageContext?: string;   // Page-specific context/instructions
  contentType: ContentType;
  notes?: string;
  tone?: string;
  language?: string;
  previousFeedback?: string;  // Used in revision flow
}

interface GeneratedContent {
  text: string;
  hashtags: string[];
  cta?: string;
}

interface ImageGeneratorOptions {
  prompt: string;
  style?: string;
  width?: number;
  height?: number;
}

interface GeneratedImage {
  url: string;
  localPath?: string;
}
```

### How to Add a New Provider

1. Create `src/modules/content-generator/providers/my-provider.ts`
2. Implement `TextProvider` or `ImageProvider` interface
3. Register in `src/modules/content-generator/index.ts`:
   ```typescript
   import { MyProvider } from './providers/my-provider';
   // Add to the appropriate map:
   textProviders['myprovider'] = () => new MyProvider();
   ```
4. Add API key to `SETTING_KEYS` in `src/modules/settings/index.ts`
5. Add env var to `src/config/index.ts` if needed
6. The provider becomes selectable via `PUT /api/dashboard/providers/text` or `/image`

### Extensibility

```typescript
// Runtime registration (no restart needed)
registerTextProvider('custom', () => new CustomTextProvider());
registerImageProvider('custom', () => new CustomImageProvider());
```

---

## Queue System (`src/queues/index.ts`)

### BullMQ + Redis

Three queues, all sharing the same Redis connection:

| Queue | Name | Concurrency | Purpose |
|-------|------|-------------|---------|
| `contentQueue` | `content-generation` | 15 | Text + image AI generation |
| `publishQueue` | `content-publishing` | 15 | Post to social platforms |
| `scheduleQueue` | `content-scheduler` | 1 | Periodic scan (every 60s) |

### Content Generation Worker

Triggered when content is added to the queue (manual or scheduler).

Flow:
1. Fetch ContentItem with page + campaign relations
2. Set status → `GENERATING`, emit `content:update` (started)
3. Call `generateText()` — produces text + hashtags + CTA
4. Compose full text: `text + \n\n#hashtags + \n\nCTA`, run through `extractCleanText()`
5. If contentType is IMAGE or VIDEO: generate image(s)
   - Multiple descriptions (pipe-separated `imageDescriptions`): generate each, store as `generatedImages` JSON array
   - Single description: generate one, store as `generatedImageUrl`
6. Check `campaign.autoApprove`: if true → `APPROVED`, else → `PENDING_REVIEW`
7. Update ContentItem with generated content + status
8. If not auto-approved: send Telegram notification via `sendContentForApproval()`
9. Log activity + emit realtime events throughout

**Job config:** 3 attempts, exponential backoff (5s base)

### Content Publishing Worker

Triggered when approved content needs publishing.

Flow:
1. Fetch ContentItem, log activity
2. Set status → `PUBLISHING`, emit `content:update`
3. Call `publishContent()` — delegates to platform provider (Facebook)
4. On success: status → `PUBLISHED`, save `socialPostId` + `publishedAt`
5. On failure: status → `FAILED`, increment `retryCount`, save `errorMessage`

**Job config:** 3 attempts, exponential backoff (10s base)

### Content Scheduler Worker

Runs every 60 seconds via BullMQ's `upsertJobScheduler`.

Two scans per cycle:
1. **Draft → Queue:** Cursor-based scan of all `DRAFT` items. For each, check if `scheduledAt - genLeadTime` ≤ now. If yes: set `QUEUED`, add to generation queue.
2. **Approved → Publish:** Find all `APPROVED` items with `scheduledAt ≤ now`. Add each to publish queue.

### Adding Jobs Manually

```typescript
import { contentQueue, publishQueue } from '../queues';

// Queue content for generation
await contentQueue.add('generate', { contentItemId: item.id }, {
  jobId: `gen-${item.id}-${Date.now()}`,
  attempts: 3,
  backoff: { type: 'exponential', delay: 5000 },
});

// Queue content for publishing
await publishQueue.add('publish', { contentItemId: item.id }, {
  jobId: `pub-${item.id}-${Date.now()}`,
  attempts: 3,
  backoff: { type: 'exponential', delay: 10000 },
});
```

---

## Publishing System (`src/modules/publisher/`)

### Orchestrator (`index.ts`)

`publishContent(contentItemId)` validates:
- Content exists
- Status is `APPROVED` or `FAILED` (retry)
- `generatedText` exists

Then dispatches by `page.platform`:
- `FACEBOOK` → `publishToFacebook()`
- `TIKTOK` → placeholder (not implemented)

### Facebook Provider (`providers/facebook.ts`)

Uses Facebook Graph API v21.0.

Supports:
- **Text-only post:** `POST /{pageId}/feed?message=...`
- **Single image (URL):** `POST /{pageId}/photos?url=...&message=...`
- **Single image (local file):** Multipart upload to `/{pageId}/photos`
- **Multi-image album:** Upload each photo unpublished, then create album post with `attached_media`
- **Scheduled publishing:** `scheduled_publish_time` parameter

### Adding a New Platform

1. Create `src/modules/publisher/providers/tiktok.ts`
2. Implement a function matching the publish pattern:
   ```typescript
   export async function publishToTikTok(params: {...}): Promise<PublishResult> { ... }
   ```
3. Add the case in `src/modules/publisher/index.ts` switch statement
4. `PublishResult` interface: `{ success: boolean, postId?: string, error?: string, url?: string }`

---

## Revision System (`src/modules/revision/index.ts`)

### Concept

Users can request edits to generated content. A `RevisionSession` tracks the active revision with a 1-hour expiry.

### Flow

1. **Create session:** `createRevisionSession(params)`
   - Cancels any existing active sessions for same content
   - Validates content isn't currently processing (GENERATING/PUBLISHING)
   - Creates RevisionSession with `WAITING_FEEDBACK` status, 1hr expiry
   - Sets content status → `REVISION_REQUESTED`

2. **Submit feedback:** `submitFeedbackAndExecute(params)`
   - Validates session active + not expired
   - Saves feedback text, sets session → `PROCESSING`
   - Creates ApprovalLog entry
   - Calls `executeRevision()`

3. **Execute revision:** Depends on `revisionType`:
   - **TEXT:** Re-generates text with `previousFeedback` parameter
   - **IMAGE:** Re-generates images with feedback appended to prompt
     - Supports selective image revision (only specific images by index via `selectedMediaIds`)
   - **VIDEO:** Similar to image (placeholder, uses image gen)
   - **TEXT_AND_MEDIA:** Both text and image revision

4. **Version history:** Every revision creates a `ContentRevision` entry:
   - Version 0 = original (saved on first revision)
   - Version N = each subsequent revision with feedback

5. **Completion:** Content → `PENDING_REVIEW`, session → `COMPLETED`

### Session Sources

Revisions can be initiated from:
- **Web UI:** via `POST /api/dashboard/content/:id/revision`
- **Telegram Bot:** via inline keyboard callbacks

---

## Realtime Events (`src/realtime/index.ts`)

### Socket.IO Setup

- Auth: JWT token in handshake (`socket.handshake.auth.token`)
- Rooms: `user:{userId}` (auto-joined), `page:{pageId}` (subscribed)
- Transports: WebSocket + polling fallback

### Event Types

**Server → Client:**

| Event | Payload | Scope |
|-------|---------|-------|
| `content:update` | `ContentEvent` | Page room (subscribers only) |
| `content:update:global` | `ContentEvent` | All connected clients |
| `content:counts` | `{ pageId, counts }` | Page room |
| `activity:update` | `ActivityEvent` | All connected clients |

**Client → Server:**

| Event | Payload | Effect |
|-------|---------|--------|
| `subscribe:page` | `pageId: string` | Join page room |
| `unsubscribe:page` | `pageId: string` | Leave page room |
| `subscribe:scope` | `{ type, pageIds[] }` | Join multiple page rooms (max 500) |

### ContentEvent Shape

```typescript
{
  contentId: string;
  pageId: string;
  campaignId?: string;
  operation: 'generate' | 'publish' | 'approve' | 'delete' | 'bulk_generate' | 'bulk_publish' | 'bulk_approve' | 'bulk_delete';
  status: 'started' | 'progress' | 'completed' | 'failed';
  step?: string;               // Vietnamese label
  progressCurrent?: number;    // For multi-image generation
  progressTotal?: number;
  safeMessage?: string;        // User-facing status message
  contentTitle?: string;
  pageName?: string;
  pageAvatar?: string;         // Facebook profile picture URL
  campaignName?: string;
  thumbnailUrl?: string;       // Generated image URL
  contentStatus?: string;      // New ContentStatus value
  startedAt?: string;
  updatedAt: string;
  version: number;             // Monotonic, for optimistic updates
}
```

### Emitting Events (backend usage)

```typescript
import { emitContentUpdate, emitActivity, emitStatusCounts } from '../realtime';

emitContentUpdate({ contentId, pageId, operation: 'generate', status: 'completed', ... });
emitActivity({ id, action, category, status, summary, ... });
emitStatusCounts(pageId, { DRAFT: 5, PUBLISHED: 10, ... });
```

---

## Workspace Scoping (`src/modules/workspace/index.ts`)

### Concept

Pages can be grouped into Workspaces. Most list/filter endpoints accept `scopeType` + `scopeId` to filter by scope.

### Scope Resolution

```typescript
import { resolvePageIds } from '../modules/workspace';

// Returns array of page IDs based on scope
const pageIds = await resolvePageIds(scopeType, scopeId);
// scopeType = 'all'       → all active pages
// scopeType = 'page'      → [scopeId]
// scopeType = 'workspace' → all pages in workspace
```

This function is used throughout: content listing, stats, calendar, campaigns, etc.

### Workspace Features

- Auto-generated slug from name (slugify, append random suffix on collision)
- Color and icon fields for UI grouping
- M:N relationship with Pages via `WorkspacePage` join table

---

## Activity Logging (`src/utils/activity.ts`)

### Pattern

Every significant operation logs to `ActivityLog` AND emits a realtime event:

```typescript
import { logActivity, updateActivity, sanitizeError } from '../utils/activity';

// Start operation
const actId = await logActivity({
  action: 'generate',
  category: 'content',
  summary: 'Đang gen nội dung: ...',
  entityType: 'content',
  entityId: contentItemId,
  entityLabel: topic,
});

// On completion
await updateActivity(actId, { status: 'success', summary: 'Gen xong: ...' });

// On error
const safe = sanitizeError(err);  // Strips sensitive info, extracts error code
await updateActivity(actId, { status: 'error', summary: '...', detail: safe.message, errorCode: safe.code });
```

### Categories

`content`, `publish`, `system`, `bulk`, etc. — used for filtering the activity feed.

---

## Utility Functions

### `src/utils/clean-text.ts`

`extractCleanText(text)` — strips markdown formatting artifacts, normalizes whitespace for social media posting.

### `src/utils/db.ts`

```typescript
export const prisma = new PrismaClient();
```

### `src/utils/logger.ts`

Pino logger instance with `pino-pretty` for development.

---

## Key Commands

```bash
# Backend
npm run dev              # Start dev server (tsx watch)
npm run build            # TypeScript compile
npm start                # Production (node dist/index.js)
npm run db:migrate       # Prisma migration
npm run db:generate      # Regenerate Prisma client
npm run db:seed          # Seed database
npm run typecheck        # TypeScript check (no emit)

# Frontend
cd frontend
npm run dev              # Vite dev server
npm run build            # Production build
```

---

## Code Conventions

### Backend Patterns

- **Express routers:** Each module exports an Express Router, mounted in `src/index.ts`
- **Error handling:** Try-catch in route handlers, return `{ error: message }` with appropriate status code
- **Async:** All route handlers are async, errors caught per-handler
- **Logging:** Use `logger.info/error/debug()` from Pino (structured logging with objects)
- **Activity + Realtime:** Every mutation emits both an ActivityLog entry and a Socket.IO event
- **Vietnamese strings:** All user-facing messages (activity summaries, status labels) are in Vietnamese

### File Upload Patterns

```typescript
// Multer config for images
const imageUpload = multer({
  storage: multer.diskStorage({ destination: 'public/uploads/', filename: unique }),
  limits: { fileSize: 20 * 1024 * 1024 },  // 20MB
  fileFilter: allowOnly(['image/jpeg', 'image/png', 'image/gif', 'image/webp']),
});

// Video: 500MB limit, mp4/mov/avi/webm/mkv
```

Files saved to `public/uploads/`, served via Express static at `/uploads/`.

### Naming

- Files: `kebab-case.ts`
- Exports: named exports (no default exports)
- DB models: PascalCase in Prisma, snake_case in PostgreSQL via `@@map`
- API responses: camelCase JSON

---

## Frontend (`frontend/` directory)

Build a React + Vite + TypeScript frontend.
The backend API runs at `http://localhost:3000/api/`.

### Tech Stack

- React 18+ with TypeScript
- Vite for bundling
- Tailwind CSS for styling
- React Router for navigation
- Socket.IO client for realtime updates
- Chart.js or Recharts for data visualization
- Day.js for date formatting (timezone: `Asia/Ho_Chi_Minh`)

### Pages to Build

1. **Login/Register** — email + password auth
2. **Dashboard** — KPI cards, charts (viewers, engagement, posts), pipeline summary, top content, pending items
3. **Content Management** — data grid with filters (status, page, campaign, date, search, metrics), bulk actions, detail drawer with approval/revision
4. **Calendar View** — content schedule on calendar
5. **Campaigns** — CRUD, Excel import, content list per campaign
6. **Pages Management** — add/edit Facebook pages, token exchange flow
7. **Workspaces** — group pages into workspaces, scope selector
8. **Settings** — AI provider config, API keys, system settings
9. **Activity Feed** — live activity log with realtime updates

### UI/UX Notes

- Language: Vietnamese for all user-facing text
- Timezone: Asia/Ho_Chi_Minh (UTC+7) for all date displays
- Brand color: `#3b82f6` (Tailwind blue-500)
- Mobile-responsive design
- Dark mode support is optional but welcome

---

## API Reference

Base URL: `http://localhost:3000`

Full API reference with all 60+ endpoints is in **`docs/API.md`**.

### Quick Reference

```
# Auth
POST /api/auth/login          { email, password } → { token, user }
POST /api/auth/register       { email, password, name } → { token, user }
GET  /api/auth/me             → user object

# Campaigns
GET    /api/campaigns         ?scopeType&scopeId&pageId
POST   /api/campaigns         { name, pageId, ... }
GET    /api/campaigns/:id     → campaign with content items
PUT    /api/campaigns/:id
DELETE /api/campaigns/:id
GET    /api/campaigns/template?type=ai|ready   → Excel download
POST   /api/campaigns/import  (multipart)

# Content (CRUD + Actions)
GET    /api/dashboard/content         ?status&pageIds&statuses&search&sortBy&page&pageSize (see docs/API.md)
POST   /api/dashboard/content         { pageId, topic, scheduledAt, ... }
PATCH  /api/dashboard/content/:id
DELETE /api/dashboard/content/:id
POST   /api/dashboard/content/:id/approve
POST   /api/dashboard/content/:id/reject
POST   /api/dashboard/content/:id/request-edit
POST   /api/dashboard/content/:id/regenerate
POST   /api/dashboard/content/:id/publish-now

# Bulk Actions
POST   /api/dashboard/content/bulk/generate    { ids[] }
POST   /api/dashboard/content/bulk/approve     { ids[] }
POST   /api/dashboard/content/bulk/publish     { ids[] }
POST   /api/dashboard/content/bulk/delete      { ids[] }

# Stats
GET    /api/dashboard/stats
GET    /api/dashboard/stats/dashboard    ?pageId&campaignId&dateFrom&dateTo&days&scopeType&scopeId
GET    /api/dashboard/stats/timeline     ?days=30
GET    /api/dashboard/stats/campaigns
GET    /api/dashboard/stats/pages

# Pages
GET    /api/dashboard/pages              ?all=true
POST   /api/dashboard/pages
POST   /api/dashboard/pages/fb-token-exchange   { shortToken }

# Workspaces
GET    /api/workspaces
POST   /api/workspaces                   { name, pageIds? }
GET    /api/workspaces/resolve-scope     ?type&id → { pageIds[] }

# Providers
GET    /api/dashboard/providers
PUT    /api/dashboard/providers/text     { provider }
PUT    /api/dashboard/providers/image    { provider }

# Settings
GET    /api/dashboard/settings           → masked values
PUT    /api/dashboard/settings           { key: value, ... }

# Activity
GET    /api/dashboard/activity           ?category&limit&cursor

# Calendar
GET    /api/dashboard/calendar           ?from&to&pageId&scopeType&scopeId
```

### Realtime (Socket.IO)

```javascript
const socket = io('http://localhost:3000', {
  auth: { token: '<jwt_token>' }
});

// Listen
socket.on('content:update', (event) => { /* per-page content changes */ });
socket.on('content:update:global', (event) => { /* all content changes */ });
socket.on('content:counts', ({ pageId, counts }) => { /* status counts */ });
socket.on('activity:update', (event) => { /* activity feed */ });

// Subscribe
socket.emit('subscribe:page', pageId);
socket.emit('subscribe:scope', { type: 'workspace', pageIds: [...] });
```

---

## Environment Variables

```bash
# Required
DATABASE_URL=postgresql://user:pass@localhost:5432/mkttools

# Optional (with defaults)
PORT=3000
NODE_ENV=development
REDIS_URL=redis://localhost:6379
DEFAULT_TIMEZONE=Asia/Ho_Chi_Minh

# AI Providers (at least one text + one image key needed)
AI_TEXT_PROVIDER=claude                    # claude | openai | gemini
AI_IMAGE_PROVIDER=gemini                   # dalle | gemini
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
GEMINI_API_KEY=AI...

# Facebook
FACEBOOK_APP_ID=
FACEBOOK_APP_SECRET=

# Telegram (optional)
TELEGRAM_BOT_TOKEN=
TELEGRAM_ADMIN_CHAT_IDS=123456789,987654321
```
