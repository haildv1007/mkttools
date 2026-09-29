# Milestone 2 / 2.1 Handoff

Snapshot of what M2 + M2.1 shipped, so the next milestone can pick up
without re-reading every commit.

## Multi-tenant / access model

- Organization → OrganizationMember → (workspace + page grants).
- `organization_members.access_mode`: `ALL` (default, preserves pre-M2
  behavior) or `RESTRICTED`.
- `organization_member_workspaces` and `organization_member_pages` hold
  the restricted grants. Workspace grants dynamically confer their pages.
- OWNER / ADMIN are always effectively `ALL`; the API forbids restricting
  them and role promotion forces `accessMode=ALL`.
- Central service: `src/modules/access/index.ts`
  - `getAccessContext(orgId, userId)`
  - `getAccessiblePageIds(ctx)`
  - `getAccessibleWorkspaceIds(ctx)`
  - `canAccessPage(ctx, pageId)`, `canAccessWorkspace(ctx, workspaceId)`
  - `assertPageAccess`, `assertWorkspaceAccess`
- Request-scoped access flags live on `AuthRequest`:
  `organizationRole`, `accessMode`, `isAllAccess`.

Routes enforcing access:
- Pages/content/campaigns/workspaces list + detail (`src/modules/dashboard/index.ts`,
  `src/modules/campaign/index.ts`, `src/modules/workspace/index.ts`).
- Mutations use `loadContentInOrg(id, orgId, req)` which returns 404 for
  restricted callers.
- Activity feed filters by accessible content entity ids.
- Realtime (`src/realtime/index.ts`): only ALL-access sockets join
  `org:{id}`; page rooms are gated by `canJoinPage`; access changes emit
  `member:access-changed` on `user:{userId}`.

## Invitations (M2.1)

- Schema: `organization_invitations`
  (`src/modules/invitations/index.ts`,
  `prisma/migrations/20260930_invitations_model_quality/migration.sql`).
  Statuses: `PENDING` / `ACCEPTED` / `CANCELLED` / `EXPIRED`.
- Token stored hashed (SHA-256); raw token returned exactly once from
  `POST /api/organizations-invitations`.
- Preview endpoint (no auth): `GET /api/invitations/:token`.
- Accept endpoint (auth): `POST /api/invitations/:token/accept`.
  Idempotent; enforces email match; auto-expires past TTL (14d default).
- OWNER/ADMIN only. Frontend flow: `/join/<token>` URL primes the join
  banner; user logs in with the invited email and clicks Chấp nhận.

## AI credentials

- Table: `organization_ai_credentials`.
- AES-256-GCM at rest, keyed off `AI_CREDENTIAL_KEY` env (falls back to
  `JWT_SECRET`). Utility: `src/utils/crypto.ts`
  (`encryptSecret`, `decryptSecret`, `maskSecret`).
- Router: `src/modules/ai-credentials/index.ts` — Owner/Admin only for
  writes; masked list for Owner/Admin; boolean-only for Manager/Member.
- Resolver: `resolveCredential({organizationId, provider})`. If no row
  exists but the legacy `app_settings` key is present, transparently
  encrypts and adopts it (one-shot migration on first use). API responses
  never carry the plaintext key.
- Job payloads never carry the API key. Workers call `resolveCredential`
  themselves.

## AI model resolution (M2.1)

- Catalog: `src/modules/ai-credentials/provider-models.ts`
  - `PROVIDER_MODELS[provider][operation][quality] = modelId`
  - Operations: `TEXT_GENERATION`, `TEXT_REVISION`, `IMAGE_GENERATION`,
    `IMAGE_REVISION`, `VIDEO_GENERATION`.
  - Quality tiers: `FAST` / `BALANCED` / `QUALITY`.
  - Providers with real integrations: `claude`, `openai`, `gemini`.
- Resolver: `resolveModel({organizationId, provider, operation,
  qualityTier?, explicitModel?})`.
  - Explicit model must be in the catalog for that provider.
  - Falls back to org `defaultQuality` → `BALANCED` → first supported tier.
  - Throws `AiModelNotSupportedError` if provider does not support the
    operation.
- Column `organization_ai_credentials.default_quality` (`AiQualityTier`
  enum) stores the org default.
- `PUT /api/ai-credentials/:provider` accepts `defaultQuality` and
  validates `defaultModel` through `providerSupportsModel`.

## Generation pipeline refit

- `src/modules/content-generator/index.ts` calls `attachCredential`,
  which resolves both credential (`resolveCredential`) and model
  (`resolveModel`) before delegating to the stateless provider.
- Providers (`src/modules/content-generator/providers/*.ts`) now build
  their SDK client from `options.credential.apiKey` per call — no more
  `config.ai.*` reads at request time.
- Job payload (`src/queues/index.ts`) carries `{organizationId,
  actorUserId, qualityTier?, contentId}`. Worker re-validates actor
  access before generating.

## Frontend hooks

- `X-Organization-Id` header on every API call
  (`public/index.html` `api()` helper).
- Socket handshake carries `organizationId`; listens for `org:denied`,
  `page:denied`, `member:access-changed`.
- Organization settings modal now has:
  - Members list with access summary + `Quản lý quyền` drawer.
  - Invitation form + pending invitation list + `Sao chép liên kết mời`.
  - AI Providers panel with masked key, validation status, and a
    quality-tier select (Nhanh / Cân bằng / Chất lượng cao).
- `/join/<token>` route triggers the join banner (`joinPreview` +
  `acceptInvitation()`).

## Deliberately out of scope

Reserved but not implemented (spec §14, §66):

- AI usage metering / credits / cost accounting / billing.
- `PERSONAL_KEY` and `PLATFORM_API` credential sources — schema knows
  them, resolver refuses them at the API surface.
- Platform Admin Console (deferred to Milestone 2.5).
- Meta auto-sync scheduler.
- Full permission builder / custom role builder.
- Email delivery for invitations (URL is copied by the inviter).

## Key file paths

- Schema: `prisma/schema.prisma`
- Migrations: `prisma/migrations/2026093{0,1}_*`
- Access: `src/modules/access/index.ts`
- Invitations: `src/modules/invitations/index.ts`
- AI credentials + resolver: `src/modules/ai-credentials/index.ts`
- Model catalog: `src/modules/ai-credentials/provider-models.ts`
- Content generator gateway: `src/modules/content-generator/index.ts`
- Realtime rooms: `src/realtime/index.ts`
- Middleware: `src/middleware/auth.ts`
- Router wiring: `src/index.ts`
- Frontend: `public/index.html`
