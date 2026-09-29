# Subscription Limits + Trial Foundation — Handoff

## Schema changes

**`SubscriptionStatus` enum** — added `TRIAL` (existing: `ACTIVE`, `EXPIRED`, `CANCELLED`).

**`OrganizationSubscription`** — added `trial_started_at`, `trial_ends_at` (nullable).

**`TrialPolicy`** (`trial_policy`) — single-row config table (`id = 'trial_policy_singleton'`):
- `trial_enabled` bool (default true)
- `trial_days` int (default 7)
- `trial_max_pages` int (default 2)
- `trial_max_members` int (default 2)

Seeded in migration `20261002_trial_foundation`. Platform Admin M2.5 edits via `PATCH /api/organizations/trial-policy`.

**`UserTrialEntitlement`** (`user_trial_entitlements`) — durable per-user record that an owner consumed their one free trial:
- `user_id` UNIQUE — prevents second free trial on new org creation.
- `organization_id` — which org the trial was consumed on.
- `started_at` — trial start timestamp.

## Member quota

`OrganizationQuota.getMemberLimit(orgId)` and `canAddMember`/`assertCanAddMember` are implemented.

Only ACTIVE org members count. When full: `MEMBER_LIMIT_REACHED` (422).

Enforcement points:
- `POST /api/organizations/:id/members` — add existing user
- `POST /api/organizations-invitations` — create invitation
- `POST /api/invitations/:token/accept` — re-checked at accept time

Downgrades never remove existing members (over-limit state is allowed; new additions blocked).

## Subscription context resolver

`resolveSubscriptionContext(orgId)` — central function in `src/modules/organization/index.ts`:

- Queries for `ACTIVE` or `TRIAL` subscription.
- For `TRIAL`: if `trialEndsAt <= now`, lazily updates to `EXPIRED` and returns `status: 'EXPIRED'`.
- For `ACTIVE`: effective limits = `customMaxPages ?? plan.maxPages`, `customMaxMembers ?? plan.maxMembers`.
- For `TRIAL`: effective limits = `trialMaxPages` / `trialMaxMembers` from `TrialPolicy` (never plan limits).
- Returns: `status`, `isTrial`, `pageLimit`, `memberLimit`, `trialDaysRemaining`, `planCode`, `planName`.

No cron needed. Expiration is detected on every subscription read.

## Trial start (register flow)

`src/middleware/auth.ts` — on new user registration:
1. Fetch `TrialPolicy`.
2. Check `UserTrialEntitlement` for this user_id.
3. If trial enabled AND no prior entitlement → create `TRIAL` subscription + `UserTrialEntitlement` row.
4. Else → create `ACTIVE` STARTER_3 subscription (no trial).

The default MKT Tools org created by M1 migration keeps its `ENTERPRISE ACTIVE` subscription.

## Trial abuse prevention

`UserTrialEntitlement` is per-user, stored durably. A user who created Org A and got a trial cannot get another trial by creating Org B — the entitlement check blocks it at step 2 above.

## SUBSCRIPTION_EXPIRED blocking

`OrganizationQuota.assertSubscriptionActive(orgId)` throws `SUBSCRIPTION_EXPIRED` when status is `EXPIRED` or `NONE`.

Enforced at:
- `POST /api/pages` (connect new Page)
- `POST /api/content/generate-all-drafts`
- `POST /api/content/:id/regenerate`
- `POST /api/content/:id/publish-now`
- `POST /api/organizations-invitations`
- `POST /api/organizations/:id/members`

Expired trial: login, org access, pages list, content history all remain accessible (read-only).

HTTP status 402 with `{ error: 'SUBSCRIPTION_EXPIRED', message: '...' }`.

## Customer subscription summary API

`GET /api/organizations/:id/subscription` — any active org member:

```json
{
  "subscriptionStatus": "TRIAL",
  "isTrial": true,
  "trialStartedAt": "...",
  "trialEndsAt": "...",
  "trialDaysRemaining": 5,
  "planCode": null,
  "planName": "Dùng thử",
  "pageUsage": { "used": 1, "limit": 2 },
  "memberUsage": { "used": 1, "limit": 2 }
}
```

Also included in `/api/organizations/current` under `subscription`.

## Platform Admin APIs

- `PATCH /api/organizations/trial-policy` — edit trial policy (trialEnabled, trialDays, trialMaxPages, trialMaxMembers).
- `PATCH /api/organizations/plans/:planId` — edit plan (name, maxPages, maxMembers, isActive, sortOrder).
- `PUT /api/organizations/:id/subscription` — upgrade Trial→Active or change plan (cancels both ACTIVE + TRIAL before creating new ACTIVE sub; trial entitlement preserved).

## Frontend

- Org settings modal shows trial badge, days remaining, expired state with "Liên hệ nâng cấp" CTA.
- "Sắp hết hạn" badge when ≤ 2 days remaining.
- Sidebar shows `· Dùng thử còn Xd` or `· Hết hạn`.
- Pages X/Y and Thành viên X/Y rendered from `pageUsage` / `memberUsage`.

## Migration

`prisma/migrations/20261002_trial_foundation/migration.sql`

## Key file paths

- `src/modules/organization/index.ts` — `resolveSubscriptionContext`, `OrganizationQuota`, trial policy API
- `src/middleware/auth.ts` — trial start at register
- `src/modules/invitations/index.ts` — SUBSCRIPTION_EXPIRED + MEMBER_LIMIT_REACHED guards
- `src/modules/dashboard/index.ts` — SUBSCRIPTION_EXPIRED guards on page/generate/publish
- `prisma/schema.prisma` — TrialPolicy, UserTrialEntitlement, SubscriptionStatus.TRIAL
- `public/index.html` — trial UI in org settings + sidebar
