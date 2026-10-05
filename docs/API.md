# MKT Tools — API Reference

Base URL: `http://localhost:3000`

All endpoints under `/api/campaigns`, `/api/dashboard`, `/api/workspaces` require:
```
Authorization: Bearer <jwt_token>
```

---

## Authentication

### POST /api/auth/login
```json
// Request
{ "email": "admin@example.com", "password": "admin123" }

// Response 200
{ "token": "eyJ...", "user": { "id": "clx...", "email": "admin@example.com", "name": "Admin", "role": "ADMIN" } }
```

### POST /api/auth/register
```json
// Request
{ "email": "new@example.com", "password": "pass123", "name": "New User" }

// Response 200 (same as login)
```

### GET /api/auth/me
```json
// Response 200
{ "id": "clx...", "email": "admin@example.com", "name": "Admin", "role": "ADMIN", "telegramChatId": null, "createdAt": "2026-..." }
```

---

## Enums

| Enum | Values |
|------|--------|
| UserRole | `OWNER` `ADMIN` `VIEWER` |
| Platform | `FACEBOOK` `TIKTOK` |
| ContentType | `IMAGE` `VIDEO` `TEXT` |
| ContentStatus | `DRAFT` `QUEUED` `GENERATING` `PENDING_REVIEW` `REVISION_REQUESTED` `APPROVED` `PUBLISHING` `PUBLISHED` `FAILED` `CANCELLED` |
| ContentSource | `AI` `MANUAL` `IMPORT` |
| ApprovalAction | `APPROVE` `REJECT` `REQUEST_EDIT` |
| RevisionType | `TEXT` `IMAGE` `VIDEO` `TEXT_AND_MEDIA` |

---

## Campaigns `/api/campaigns`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | List campaigns. Query: `scopeType`, `scopeId`, `pageId` |
| POST | `/` | Create campaign |
| GET | `/:id` | Get campaign with content items |
| PUT | `/:id` | Update campaign |
| DELETE | `/:id` | Delete campaign + all content items |
| GET | `/template?type=ai\|ready` | Download Excel template |
| POST | `/import` | Import Excel (multipart: `file`, `pageId`, `userId`) |

---

## Dashboard `/api/dashboard`

### Stats

| Method | Path | Description |
|--------|------|-------------|
| GET | `/stats` | Overview: totals, status/source/type breakdowns, today stats |
| GET | `/stats/dashboard` | Full dashboard data. Query: `pageId`, `campaignId`, `dateFrom`, `dateTo`, `days`, `scopeType`, `scopeId` |
| GET | `/stats/timeline?days=30` | Daily created vs published counts |
| GET | `/stats/campaigns` | Top 7 campaigns by performance |
| GET | `/stats/pages` | All pages with content stats |
| GET | `/stats/upcoming` | Next 7 days content |
| GET | `/stats/recent-published` | Last 10 published |
| GET | `/stats/fb-insights` | Live Facebook metrics per page/post |
| POST | `/stats/fb-sync` | Sync FB metrics to DB. Body: `{ pageId? }` |

### Content Grid

| Method | Path | Description |
|--------|------|-------------|
| GET | `/content` | Paginated content list with filters, sorting, status counts, metrics summary |
| GET | `/content/:id` | Content detail with page, campaign, approval logs |
| POST | `/content` | Create content item |
| PATCH | `/content/:id` | Update content fields |
| DELETE | `/content/:id` | Delete content |
| GET | `/content/active` | Currently processing items |
| GET | `/content/campaigns-for-pages?pageIds=csv` | Campaigns for given pages |

**GET /content query params:**
`status`, `pageId`, `statuses` (CSV), `pageIds` (CSV), `sources` (CSV), `contentTypes` (CSV), `campaignIds` (CSV), `search`, `dateFrom`, `dateTo`, `createdFrom`, `createdTo`, `publishedFrom`, `publishedTo`, `metricFilter` (JSON), `scopeType`, `scopeId`, `sortBy` (scheduledAt/createdAt/publishedAt/topic/status/contentType/source), `sortDir` (asc/desc), `page` (default 1), `pageSize` (default 50, max 200)

### Content Actions

| Method | Path | Body | Description |
|--------|------|------|-------------|
| POST | `/content/:id/approve` | `{ userId? }` | Approve content |
| POST | `/content/:id/reject` | `{ userId?, feedback? }` | Reject (cancel) content |
| POST | `/content/:id/request-edit` | `{ userId?, feedback? }` | Request revision |
| POST | `/content/:id/regenerate` | - | Re-queue for AI generation |
| POST | `/content/:id/publish-now` | - | Publish immediately |
| POST | `/content/:id/sync-metrics` | - | Sync FB metrics for one post |

### Bulk Actions

| Method | Path | Body |
|--------|------|------|
| POST | `/content/bulk/generate` | `{ ids: string[] }` |
| POST | `/content/bulk/approve` | `{ ids: string[], userId? }` |
| POST | `/content/bulk/publish` | `{ ids: string[] }` |
| POST | `/content/bulk/delete` | `{ ids: string[] }` |
| POST | `/content/generate-all-drafts` | - |

### File Uploads

| Method | Path | Multipart Field | Limits |
|--------|------|----------------|--------|
| POST | `/content/:id/upload-image` | `image` | 20MB, jpg/jpeg/png/gif/webp |
| POST | `/content/:id/upload-images` | `images` | 10 files max |
| POST | `/content/:id/upload-video` | `video` | 500MB, mp4/mov/avi/webm/mkv |
| DELETE | `/content/:id/video` | - | Deletes video file |

### Revisions

| Method | Path | Body |
|--------|------|------|
| POST | `/content/:id/revision` | `{ revisionType, selectedMediaIds?, feedbackText?, userId? }` |
| GET | `/content/:id/revisions` | - |
| POST | `/revision/:id/feedback` | `{ feedbackText, userId? }` |
| POST | `/revision/:id/cancel` | - |

### Pages

| Method | Path | Description |
|--------|------|-------------|
| GET | `/pages?all=true` | List pages (include inactive if all=true) |
| POST | `/pages` | Create page |
| PUT | `/pages/:id` | Update page |
| DELETE | `/pages/:id` | Soft delete |
| POST | `/pages/fb-token-exchange` | Exchange FB short token for page tokens |

### Calendar

| Method | Path | Query |
|--------|------|-------|
| GET | `/calendar` | `from`, `to` (ISO dates), `pageId`, `scopeType`, `scopeId` |

### AI Providers

| Method | Path | Description |
|--------|------|-------------|
| GET | `/providers` | List providers (text + image) |
| PUT | `/providers/text` | `{ provider: "claude"\|"openai"\|"gemini" }` |
| PUT | `/providers/image` | `{ provider: "dalle"\|"gemini"\|"openai" }` |
| POST | `/test-generate` | Test text generation |
| POST | `/test-connection` | `{ type: "text"\|"image" }` |

### Settings

| Method | Path | Description |
|--------|------|-------------|
| GET | `/settings` | Get all settings (sensitive values masked) |
| PUT | `/settings` | Save settings (skip masked "••••" values) |

### Users & Activity

| Method | Path | Description |
|--------|------|-------------|
| GET | `/users` | List all users |
| GET | `/activity` | Activity feed. Query: `category`, `limit`, `cursor` |

---

## Workspaces `/api/workspaces`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | List workspaces with pages |
| POST | `/` | Create workspace. Body: `{ name, description?, color?, icon?, pageIds? }` |
| GET | `/:id` | Get workspace |
| PUT | `/:id` | Update workspace |
| DELETE | `/:id` | Delete workspace |
| GET | `/resolve-scope?type=all\|page\|workspace&id=` | Resolve scope to page IDs |

---

## Realtime (Socket.IO)

```javascript
import { io } from 'socket.io-client';

const socket = io('http://localhost:3000', {
  auth: { token: jwtToken },
  transports: ['websocket', 'polling'],
});

// Listen
socket.on('content:update', (event) => { /* ContentEvent */ });
socket.on('content:update:global', (event) => { /* all content changes */ });
socket.on('content:counts', ({ pageId, counts }) => { /* status counts */ });
socket.on('activity:update', (event) => { /* ActivityEvent */ });

// Subscribe to specific pages
socket.emit('subscribe:page', pageId);
socket.emit('subscribe:scope', { type: 'workspace', pageIds: ['id1', 'id2'] });
```

### ContentEvent shape
```typescript
{
  contentId: string;
  pageId: string;
  operation: 'generate' | 'publish' | 'approve' | 'delete' | 'bulk_generate' | 'bulk_publish' | 'bulk_approve' | 'bulk_delete';
  status: 'started' | 'progress' | 'completed' | 'failed';
  step?: string;
  contentTitle?: string;
  pageName?: string;
  contentStatus?: string;
  updatedAt: string;
  version: number;
}
```
