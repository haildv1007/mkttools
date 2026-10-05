# MKT Tools — Agent Instructions (for OpenAI Codex and other AI agents)

## Project Overview

AI-powered social media content automation tool for Vietnamese market.
Backend API is built with Express.js + TypeScript. Your job is to build the **frontend**.

## Your Scope: Frontend (`frontend/` directory)

Build a React + Vite + TypeScript frontend in `frontend/`.
The backend API runs at `http://localhost:3000/api/`.

**DO NOT** modify anything outside `frontend/`:
- `src/` — backend code (managed by Claude)
- `prisma/` — database schema (managed by Claude)
- `public/index.html` — legacy frontend (will be removed)

## Tech Stack (Frontend)

- React 18+ with TypeScript
- Vite for bundling
- Tailwind CSS for styling
- React Router for navigation
- Socket.IO client for realtime updates
- Chart.js or Recharts for data visualization
- Day.js for date formatting (timezone: `Asia/Ho_Chi_Minh`)

## Authentication

All API calls (except `/api/auth/login` and `/api/auth/register`) require:
```
Authorization: Bearer <jwt_token>
```

### Auth Endpoints

```
POST /api/auth/login
  Body: { email: string, password: string }
  Response: { token: string, user: { id, email, name, role } }

POST /api/auth/register
  Body: { email: string, password: string, name: string }
  Response: { token: string, user: { id, email, name, role } }

GET /api/auth/me
  Response: { id, email, name, role, telegramChatId, createdAt }
```

## API Reference

Base URL: `http://localhost:3000`

### Health
```
GET /api/health → { status: "ok", timestamp, db: "connected" }
```

### Campaigns (`/api/campaigns`)
```
GET    /api/campaigns?scopeType=all|page|workspace&scopeId=<id>&pageId=<id>
POST   /api/campaigns         { name, description?, pageId, startDate?, endDate?, genLeadTime?, autoApprove?, userId }
GET    /api/campaigns/:id     → campaign with contentItems
PUT    /api/campaigns/:id     { name?, description?, genLeadTime?, autoApprove?, startDate?, endDate? }
DELETE /api/campaigns/:id

GET    /api/campaigns/template?type=ai|ready     → downloads Excel template
POST   /api/campaigns/import   (multipart: file, pageId, userId, campaignId?, campaignName?)
```

### Dashboard — Stats (`/api/dashboard`)
```
GET /api/dashboard/stats
  → { totalPages, totalCampaigns, totalContent, statusBreakdown, sourceBreakdown,
      contentTypeBreakdown, todayCreated, todayPublished, successRate, providers }

GET /api/dashboard/stats/dashboard?pageId=&campaignId=&dateFrom=&dateTo=&days=30&scopeType=&scopeId=
  → {
      synced_at, filters,
      chart_performance: [{ date, viewers, media_views, engagement, posts_count }],
      pipeline_summary: { pending_approval, generating, approved, scheduled, posted, failed, success_publish_rate },
      kpis: { total_viewers, total_media_views, total_engagement, total_reactions, ... },
      top_contents: [...],
      page_performance: [...],
      campaign_performance: [...],
      pending_items: [...],
      upcoming_posts: [...],
      recent_posts: [...]
    }

GET /api/dashboard/stats/timeline?days=30
  → [{ date, created, published }]

GET /api/dashboard/stats/campaigns
  → [{ id, name, startDate, endDate, totalContent, published, draft, pending, failed, successRate, topPageName }]

GET /api/dashboard/stats/pages
  → [{ id, name, platform, externalId, totalContent, published, successRate }]

GET /api/dashboard/stats/upcoming
  → ContentItem[] (next 7 days, status in DRAFT|QUEUED|PENDING_REVIEW|APPROVED|GENERATING)

GET /api/dashboard/stats/recent-published
  → ContentItem[] (last 10 published)

GET /api/dashboard/stats/fb-insights
  → { pages: [{ pageId, pageName, followers, totalReactions, ..., posts: [...] }], totals }

POST /api/dashboard/stats/fb-sync   { pageId? }
  → { total, synced, skipped, errors, synced_at }
```

### Dashboard — Content (`/api/dashboard`)
```
GET /api/dashboard/content?status=&pageId=&pageIds=&statuses=&sources=&contentTypes=&campaignIds=
    &search=&dateFrom=&dateTo=&createdFrom=&createdTo=&publishedFrom=&publishedTo=
    &metricFilter=JSON&scopeType=&scopeId=&sortBy=scheduledAt&sortDir=desc&page=1&pageSize=50
  → { items, total, statusCounts, summary, page, pageSize }

GET /api/dashboard/content/:id
  → ContentItem with page, campaign, approvalLogs

POST /api/dashboard/content
  { pageId, topic, contentType?, scheduledAt, notes?, imageDescriptions?, campaignId?, generatedText?, imageUrl?, videoUrl?, imageUrls? }

PATCH /api/dashboard/content/:id
  { scheduledAt?, status?, topic?, notes?, contentType?, imageDescriptions?, generatedText?, imageUrl?, videoUrl? }

DELETE /api/dashboard/content/:id

GET /api/dashboard/content/active
  → running jobs (status QUEUED|GENERATING|PUBLISHING)

GET /api/dashboard/content/campaigns-for-pages?pageIds=id1,id2
  → [{ id, name }]
```

### Content Actions
```
POST /api/dashboard/content/:id/approve       { userId? }
POST /api/dashboard/content/:id/reject        { userId?, feedback? }
POST /api/dashboard/content/:id/request-edit   { userId?, feedback? }
POST /api/dashboard/content/:id/regenerate
POST /api/dashboard/content/:id/publish-now
POST /api/dashboard/content/:id/sync-metrics
POST /api/dashboard/content/:id/upload-image   (multipart: image)
POST /api/dashboard/content/:id/upload-images  (multipart: images, max 10)
POST /api/dashboard/content/:id/upload-video   (multipart: video, max 500MB)
DELETE /api/dashboard/content/:id/video
```

### Bulk Actions
```
POST /api/dashboard/content/bulk/generate   { ids: string[] }
POST /api/dashboard/content/bulk/approve    { ids: string[], userId? }
POST /api/dashboard/content/bulk/publish    { ids: string[] }
POST /api/dashboard/content/bulk/delete     { ids: string[] }
POST /api/dashboard/content/generate-all-drafts
```

### Revisions
```
POST /api/dashboard/content/:id/revision     { revisionType: TEXT|IMAGE|VIDEO|TEXT_AND_MEDIA, selectedMediaIds?, feedbackText?, userId? }
GET  /api/dashboard/content/:id/revisions    → ContentRevision[]
POST /api/dashboard/revision/:id/feedback    { feedbackText, userId? }
POST /api/dashboard/revision/:id/cancel
```

### Dashboard — Pages
```
GET    /api/dashboard/pages?all=true|false
POST   /api/dashboard/pages        { platform: FACEBOOK|TIKTOK, name, externalId, accessToken, userId, context?, telegramGroupId? }
PUT    /api/dashboard/pages/:id    (same fields)
DELETE /api/dashboard/pages/:id    (soft delete)

POST /api/dashboard/pages/fb-token-exchange   { shortToken }
  → { pages: [{ id, name, access_token, picture }] }
```

### Dashboard — Calendar
```
GET /api/dashboard/calendar?from=ISO&to=ISO&pageId=&scopeType=&scopeId=
  → ContentItem[] with page and campaign
```

### Workspaces (`/api/workspaces`)
```
GET    /api/workspaces
POST   /api/workspaces          { name, description?, color?, icon?, pageIds?: string[] }
GET    /api/workspaces/:id
PUT    /api/workspaces/:id      { name?, description?, color?, icon?, pageIds? }
DELETE /api/workspaces/:id
GET    /api/workspaces/resolve-scope?type=all|page|workspace&id=<id>
  → { pageIds: string[] }
```

### AI Providers
```
GET  /api/dashboard/providers
PUT  /api/dashboard/providers/text    { provider: "claude"|"openai"|"gemini" }
PUT  /api/dashboard/providers/image   { provider: "dalle"|"gemini"|"openai" }
POST /api/dashboard/test-generate     { topic?, pageName?, contentType? }
POST /api/dashboard/test-connection   { type: "text"|"image" }
GET  /api/dashboard/gemini-image-models
POST /api/dashboard/test-image-model  { model }
GET  /api/dashboard/openai-image-models
POST /api/dashboard/test-openai-image-model { model }
```

### Settings
```
GET /api/dashboard/settings   → { settings: Record<string, string> }  (sensitive values masked)
PUT /api/dashboard/settings   Record<string, string>  (skip masked values starting with "••••")
```

### Users
```
GET /api/dashboard/users → [{ id, email, name, role, telegramChatId, isActive, createdAt }]
```

### Activity Feed
```
GET /api/dashboard/activity?category=all|bulk|...&limit=30&cursor=ISO
  → { items, hasMore, nextCursor }
```

## Data Models (Enums)

```typescript
UserRole:      OWNER | ADMIN | VIEWER
Platform:      FACEBOOK | TIKTOK
ContentType:   IMAGE | VIDEO | TEXT
ContentStatus: DRAFT | QUEUED | GENERATING | PENDING_REVIEW | REVISION_REQUESTED |
               APPROVED | PUBLISHING | PUBLISHED | FAILED | CANCELLED
ContentSource: AI | MANUAL | IMPORT
ApprovalAction: APPROVE | REJECT | REQUEST_EDIT
```

## Realtime (Socket.IO)

Connect to the same host as the API. Auth via handshake:
```javascript
const socket = io('http://localhost:3000', {
  auth: { token: '<jwt_token>' }
});
```

### Events to listen:
```
'content:update'        → ContentEvent (scoped to subscribed pages)
'content:update:global' → ContentEvent (all content changes)
'content:counts'        → { pageId, counts: Record<status, number> }
'activity:update'       → ActivityEvent
```

### Events to emit:
```
'subscribe:page'   → pageId: string
'unsubscribe:page' → pageId: string
'subscribe:scope'  → { type: string, pageIds: string[] }
```

## Pages to Build

1. **Login/Register** — email + password auth
2. **Dashboard** — KPI cards, charts (viewers, engagement, posts), pipeline summary, top content, pending items
3. **Content Management** — data grid with filters (status, page, campaign, date, search, metrics), bulk actions, detail drawer with approval/revision
4. **Calendar View** — content schedule on calendar
5. **Campaigns** — CRUD, Excel import, content list per campaign
6. **Pages Management** — add/edit Facebook pages, token exchange flow
7. **Workspaces** — group pages into workspaces, scope selector
8. **Settings** — AI provider config, API keys, system settings
9. **Activity Feed** — live activity log with realtime updates

## UI/UX Notes

- Language: Vietnamese for all user-facing text
- Timezone: Asia/Ho_Chi_Minh (UTC+7) for all date displays
- The existing `public/index.html` uses a blue brand color (`#3b82f6` / Tailwind blue-500) — match this
- Mobile-responsive design
- Dark mode support is optional but welcome
