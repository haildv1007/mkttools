import { Router, Response, NextFunction } from 'express';
import { prisma } from '../../utils/db';
import { AuthRequest } from '../../middleware/auth';

export type OrgRole = 'OWNER' | 'ADMIN' | 'MANAGER' | 'MEMBER';

const ROLE_RANK: Record<OrgRole, number> = { OWNER: 4, ADMIN: 3, MANAGER: 2, MEMBER: 1 };

export function roleAtLeast(role: OrgRole | undefined, min: OrgRole): boolean {
  if (!role) return false;
  return ROLE_RANK[role] >= ROLE_RANK[min];
}

export function canManageMemberRole(requesterRole: OrgRole, targetRole: OrgRole, nextRole?: OrgRole): boolean {
  if (!roleAtLeast(requesterRole, 'ADMIN')) return false;
  if (requesterRole === 'ADMIN' && (targetRole === 'OWNER' || nextRole === 'OWNER')) return false;
  return true;
}

export function removesLastActiveOwner(
  targetRole: OrgRole,
  targetStatus: string,
  nextRole: OrgRole,
  nextStatus: string,
  activeOwnerCount: number,
): boolean {
  return targetRole === 'OWNER' && targetStatus === 'ACTIVE'
    && !(nextRole === 'OWNER' && nextStatus === 'ACTIVE')
    && activeOwnerCount <= 1;
}

export async function listMemberships(userId: string) {
  return prisma.organizationMember.findMany({
    where: { userId, status: 'ACTIVE' },
    include: {
      organization: {
        select: { id: true, name: true, slug: true, status: true, ownerUserId: true },
      },
    },
    orderBy: { createdAt: 'asc' },
  });
}

export function readRequestedOrgId(req: AuthRequest): string | null {
  const raw = req.header('x-organization-id') || req.query.orgId || '';
  const v = Array.isArray(raw) ? String(raw[0] ?? '') : String(raw);
  return v.trim() || null;
}

/**
 * No requested id -> first accessible active org.
 * Requested id + valid membership -> that org.
 * Requested id without access -> denied (never falls back to another org).
 */
export async function resolveCurrentOrganization(userId: string, requested?: string | null) {
  const memberships = await listMemberships(userId);
  // SUSPENDED orgs stay readable; mutations are blocked centrally (see attachOrganization).
  if (requested) {
    const found = memberships.find((m) => m.organizationId === requested);
    return { memberships, current: found ?? null, denied: !found };
  }
  const first = memberships.find((m) => m.organization.status === 'ACTIVE') ?? memberships[0];
  return { memberships, current: first ?? null, denied: false };
}

export function sendOrgDenied(res: Response) {
  return res.status(403).json({ error: 'ORGANIZATION_ACCESS_DENIED', message: 'Bạn không có quyền truy cập tổ chức này.' });
}

export async function isPlatformAdmin(userId?: string): Promise<boolean> {
  if (!userId) return false;
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { isPlatformAdmin: true, isActive: true } });
  return !!u?.isPlatformAdmin && u.isActive;
}

/**
 * Extracts current organization id from either the X-Organization-Id header
 * or ?orgId query param. Validates the requesting user actually belongs.
 */
export async function requireOrganizationMember(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) {
  if (!req.userId) return res.status(401).json({ error: 'Unauthorized' });
  const { current, denied } = await resolveCurrentOrganization(req.userId, readRequestedOrgId(req));
  if (denied) return sendOrgDenied(res);
  if (!current) {
    return res.status(403).json({ error: 'NO_ORGANIZATION', message: 'Bạn chưa thuộc tổ chức nào.' });
  }
  req.organizationId = current.organizationId;
  req.organizationRole = current.role as OrgRole;
  next();
}

export function requireOrganizationRole(min: OrgRole) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!roleAtLeast(req.organizationRole, min)) {
      return res.status(403).json({ error: 'FORBIDDEN', message: 'Bạn không có quyền thực hiện thao tác này.' });
    }
    next();
  };
}

/**
 * Assert a resource-carrying object belongs to the given organization.
 * Throws a 404-shaped error via res if not.
 */
export function assertResourceOrganization(
  res: Response,
  resource: { organizationId?: string } | null | undefined,
  organizationId: string,
): boolean {
  if (!resource) {
    res.status(404).json({ error: 'NOT_FOUND' });
    return false;
  }
  if (resource.organizationId !== organizationId) {
    res.status(404).json({ error: 'NOT_FOUND' });
    return false;
  }
  return true;
}

// ---------------- Trial policy ----------------

export interface TrialPolicyConfig {
  trialEnabled: boolean;
  trialDays: number;
  trialMaxPages: number;
  trialMaxMembers: number;
}

export async function getTrialPolicy(): Promise<TrialPolicyConfig> {
  const row = (await prisma.trialPolicy.findUnique({ where: { id: 'trial_policy_singleton' } })) as any;
  if (!row) return { trialEnabled: true, trialDays: 7, trialMaxPages: 2, trialMaxMembers: 2 };
  return {
    trialEnabled: row.trialEnabled,
    trialDays: row.trialDays,
    trialMaxPages: row.trialMaxPages,
    trialMaxMembers: row.trialMaxMembers,
  };
}

// ---------------- Subscription context ----------------

export interface SubscriptionContext {
  status: 'ACTIVE' | 'TRIAL' | 'EXPIRED' | 'NONE';
  isTrial: boolean;
  pageLimit: number | null;   // null = unlimited; 0 = fully blocked
  memberLimit: number | null;
  startedAt: Date | null;
  expiresAt: Date | null;
  trialStartedAt: Date | null;
  trialEndsAt: Date | null;
  trialDaysRemaining: number | null;
  planCode: string | null;
  planName: string | null;
  customMaxPages: number | null;
  customMaxMembers: number | null;
  planMaxPages: number | null;
  planMaxMembers: number | null;
}

const DAY_MS = 24 * 3600 * 1000;

/**
 * Single source of truth for effective limits/status. Pure (no I/O) so bulk
 * callers (admin lists) can reuse it.
 * - TRIAL: limits come from trial policy, never from the plan.
 * - ACTIVE: custom_max ?? plan.max (null = unlimited).
 * - TRIAL past trial_ends_at, or ACTIVE past expires_at => EXPIRED (lazy, no cron).
 */
export function contextFromSubscription(sub: any | null, policy: TrialPolicyConfig, now = new Date()): SubscriptionContext {
  const base = {
    startedAt: sub?.startedAt ?? null,
    expiresAt: sub?.expiresAt ?? null,
    trialStartedAt: sub?.trialStartedAt ?? null,
    trialEndsAt: sub?.trialEndsAt ?? null,
    customMaxPages: sub?.customMaxPages ?? null,
    customMaxMembers: sub?.customMaxMembers ?? null,
    planMaxPages: sub?.plan?.maxPages ?? null,
    planMaxMembers: sub?.plan?.maxMembers ?? null,
  };
  if (!sub) {
    return { ...base, status: 'NONE', isTrial: false, pageLimit: 0, memberLimit: 0, trialDaysRemaining: null, planCode: null, planName: null };
  }
  const wasTrial = !!sub.trialStartedAt && sub.status !== 'ACTIVE';
  const expired = (extra: Partial<SubscriptionContext> = {}): SubscriptionContext => ({
    ...base, status: 'EXPIRED', isTrial: wasTrial, pageLimit: 0, memberLimit: 0, trialDaysRemaining: 0,
    planCode: wasTrial ? null : (sub.plan?.code ?? null), planName: wasTrial ? 'Dùng thử' : (sub.plan?.name ?? null), ...extra,
  });
  if (sub.status === 'EXPIRED' || sub.status === 'CANCELLED') return expired();
  if (sub.status === 'TRIAL') {
    if (sub.trialEndsAt && sub.trialEndsAt <= now) return expired();
    return {
      ...base, status: 'TRIAL', isTrial: true,
      pageLimit: policy.trialMaxPages, memberLimit: policy.trialMaxMembers,
      trialDaysRemaining: sub.trialEndsAt ? Math.max(0, Math.ceil((sub.trialEndsAt.getTime() - now.getTime()) / DAY_MS)) : null,
      planCode: null, planName: 'Dùng thử',
    };
  }
  if (sub.expiresAt && sub.expiresAt <= now) return expired();
  return {
    ...base, status: 'ACTIVE', isTrial: false,
    pageLimit: sub.customMaxPages != null ? sub.customMaxPages : (sub.plan?.maxPages ?? null),
    memberLimit: sub.customMaxMembers != null ? sub.customMaxMembers : (sub.plan?.maxMembers ?? null),
    trialDaysRemaining: null,
    planCode: sub.plan?.code ?? null, planName: sub.plan?.name ?? null,
  };
}

/** Pick the current subscription per org: newest ACTIVE/TRIAL, else newest of any status. */
export function pickCurrentSubscription(subs: any[]): any | null {
  const sorted = [...subs].sort((x, y) => +y.startedAt - +x.startedAt);
  return sorted.find((x) => x.status === 'ACTIVE' || x.status === 'TRIAL') ?? sorted[0] ?? null;
}

export async function resolveSubscriptionContext(orgId: string): Promise<SubscriptionContext> {
  const subs = (await prisma.organizationSubscription.findMany({
    where: { organizationId: orgId },
    include: { plan: true },
    orderBy: { startedAt: 'desc' },
  })) as any[];
  const sub = pickCurrentSubscription(subs);
  const ctx = contextFromSubscription(sub, await getTrialPolicy());
  // Lazily persist expiry so stored status converges (best-effort).
  if (sub && ctx.status === 'EXPIRED' && (sub.status === 'TRIAL' || sub.status === 'ACTIVE')) {
    await prisma.organizationSubscription.update({ where: { id: sub.id }, data: { status: 'EXPIRED' } }).catch(() => {});
  }
  return ctx;
}

// ---------------- Quota service ----------------

export const OrganizationQuota = {
  async getPageLimit(orgId: string): Promise<number | null> {
    const ctx = await resolveSubscriptionContext(orgId);
    return ctx.pageLimit;
  },

  async getPageUsage(orgId: string): Promise<number> {
    return prisma.page.count({ where: { organizationId: orgId, isActive: true } });
  },

  async canAddPage(orgId: string): Promise<{ ok: boolean; used: number; limit: number | null; reason?: string }> {
    const [limit, used] = await Promise.all([
      OrganizationQuota.getPageLimit(orgId),
      OrganizationQuota.getPageUsage(orgId),
    ]);
    if (limit == null) return { ok: true, used, limit: null };
    if (used >= limit) return { ok: false, used, limit, reason: 'PAGE_LIMIT_REACHED' };
    return { ok: true, used, limit };
  },

  async assertCanAddPage(orgId: string): Promise<void> {
    const check = await OrganizationQuota.canAddPage(orgId);
    if (!check.ok) {
      const err = new Error(`Bạn đã sử dụng hết ${check.limit} Page của gói hiện tại.`) as Error & { code?: string };
      err.code = 'PAGE_LIMIT_REACHED';
      throw err;
    }
  },

  async getMemberLimit(orgId: string): Promise<number | null> {
    const ctx = await resolveSubscriptionContext(orgId);
    return ctx.memberLimit;
  },

  async getMemberUsage(orgId: string): Promise<number> {
    return prisma.organizationMember.count({ where: { organizationId: orgId, status: 'ACTIVE' } });
  },

  async canAddMember(orgId: string): Promise<{ ok: boolean; used: number; limit: number | null; reason?: string }> {
    const [limit, used] = await Promise.all([
      OrganizationQuota.getMemberLimit(orgId),
      OrganizationQuota.getMemberUsage(orgId),
    ]);
    if (limit == null) return { ok: true, used, limit: null };
    if (used >= limit) return { ok: false, used, limit, reason: 'MEMBER_LIMIT_REACHED' };
    return { ok: true, used, limit };
  },

  async assertCanAddMember(orgId: string): Promise<void> {
    const check = await OrganizationQuota.canAddMember(orgId);
    if (!check.ok) {
      const err = new Error('Bạn đã sử dụng hết số thành viên của gói hiện tại.') as Error & { code?: string };
      err.code = 'MEMBER_LIMIT_REACHED';
      throw err;
    }
  },

  async assertSubscriptionActive(orgId: string): Promise<void> {
    const ctx = await resolveSubscriptionContext(orgId);
    if (ctx.status === 'EXPIRED' || ctx.status === 'NONE') {
      const err = new Error('Thời gian dùng thử đã kết thúc. Vui lòng nâng cấp gói để tiếp tục sử dụng.') as Error & { code?: string };
      err.code = 'SUBSCRIPTION_EXPIRED';
      throw err;
    }
  },
};

// ---------------- Router ----------------

const router = Router();

router.get('/', async (req: AuthRequest, res: Response) => {
  if (!req.userId) return res.status(401).json({ error: 'Unauthorized' });
  const memberships = await listMemberships(req.userId);
  res.json(memberships.map((m) => ({
    id: m.organization.id,
    name: m.organization.name,
    slug: m.organization.slug,
    role: m.role,
    status: m.organization.status,
    isOwner: m.organization.ownerUserId === req.userId,
  })));
});

router.get('/current', async (req: AuthRequest, res: Response) => {
  if (!req.userId) return res.status(401).json({ error: 'Unauthorized' });
  const { memberships, current, denied } = await resolveCurrentOrganization(req.userId, readRequestedOrgId(req));
  if (denied) return sendOrgDenied(res);
  if (!current) return res.json({ current: null, memberships: [] });
  const [subCtx, pageUsed, memberUsed] = await Promise.all([
    resolveSubscriptionContext(current.organizationId),
    OrganizationQuota.getPageUsage(current.organizationId),
    OrganizationQuota.getMemberUsage(current.organizationId),
  ]);
  res.json({
    current: {
      id: current.organization.id,
      name: current.organization.name,
      slug: current.organization.slug,
      role: current.role,
      isOwner: current.organization.ownerUserId === req.userId,
      status: current.organization.status,
    },
    memberships: memberships.map((m) => ({
      id: m.organization.id,
      name: m.organization.name,
      role: m.role,
      status: m.organization.status,
    })),
    subscription: {
      subscriptionStatus: subCtx.status,
      isTrial: subCtx.isTrial,
      trialStartedAt: subCtx.trialStartedAt,
      trialEndsAt: subCtx.trialEndsAt,
      trialDaysRemaining: subCtx.trialDaysRemaining,
      expiresAt: subCtx.expiresAt,
      planCode: subCtx.planCode,
      planName: subCtx.planName,
    },
    pageUsage: { used: pageUsed, limit: subCtx.pageLimit },
    memberUsage: { used: memberUsed, limit: subCtx.memberLimit },
  });
});

// Update organization (name)
router.patch('/:id', async (req: AuthRequest, res: Response) => {
  if (!req.userId) return res.status(401).json({ error: 'Unauthorized' });
  const id = String(req.params.id);
  const member = await prisma.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId: id, userId: req.userId } },
  });
  if (!member || member.status !== 'ACTIVE' || !roleAtLeast(member.role as OrgRole, 'ADMIN')) {
    return res.status(403).json({ error: 'FORBIDDEN' });
  }
  const { name } = req.body || {};
  const org = await prisma.organization.update({
    where: { id },
    data: { name: name?.toString().trim() || undefined },
  });
  res.json({ id: org.id, name: org.name });
});

// Members list
router.get('/:id/members', async (req: AuthRequest, res: Response) => {
  if (!req.userId) return res.status(401).json({ error: 'Unauthorized' });
  const id = String(req.params.id);
  const requester = await prisma.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId: id, userId: req.userId } },
  });
  if (!requester || requester.status !== 'ACTIVE') return res.status(403).json({ error: 'FORBIDDEN' });
  const members = await prisma.organizationMember.findMany({
    where: { organizationId: id },
    include: {
      user: { select: { id: true, email: true, name: true } },
      workspaceGrants: { select: { workspaceId: true } },
      pageGrants: { select: { pageId: true } },
    },
    orderBy: { createdAt: 'asc' },
  }) as any[];
  const { getAccessiblePageIds } = await import('../access');
  const rows = await Promise.all(members.map(async (m: any) => {
    const role = m.role as OrgRole;
    const isAllAccess = role === 'OWNER' || role === 'ADMIN' || m.accessMode === 'ALL';
    const ctx = { organizationId: id, userId: m.userId, role, accessMode: m.accessMode, memberId: m.id, isAllAccess };
    const accessiblePages = isAllAccess ? null : await getAccessiblePageIds(ctx);
    return {
      id: m.id,
      userId: m.userId,
      email: m.user.email,
      name: m.user.name,
      role: m.role,
      status: m.status,
      accessMode: m.accessMode,
      isAllAccess,
      workspaceGrantCount: m.workspaceGrants.length,
      pageGrantCount: m.pageGrants.length,
      effectivePageCount: accessiblePages ? accessiblePages.length : null,
      createdAt: m.createdAt,
    };
  }));
  res.json(rows);
});

// Add existing user to organization by email
router.post('/:id/members', async (req: AuthRequest, res: Response) => {
  if (!req.userId) return res.status(401).json({ error: 'Unauthorized' });
  const id = String(req.params.id);
  const requester = await prisma.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId: id, userId: req.userId } },
  });
  if (!requester || requester.status !== 'ACTIVE' || !roleAtLeast(requester.role as OrgRole, 'ADMIN')) {
    return res.status(403).json({ error: 'FORBIDDEN' });
  }
  const { email, role } = req.body || {};
  const wantedRole: OrgRole = ['ADMIN', 'MANAGER', 'MEMBER'].includes(role) ? role : 'MEMBER';
  const user = await prisma.user.findUnique({ where: { email: String(email || '').trim().toLowerCase() } });
  if (!user) return res.status(404).json({ error: 'USER_NOT_FOUND', message: 'Không tìm thấy user với email này.' });
  const orgRow = await prisma.organization.findUnique({ where: { id }, select: { status: true } });
  if (orgRow?.status === 'SUSPENDED') {
    return res.status(403).json({ error: 'ORGANIZATION_SUSPENDED', message: 'Tổ chức đang bị tạm ngưng. Vui lòng liên hệ hỗ trợ.' });
  }
  // Block if subscription expired
  const subCtxForAdd = await resolveSubscriptionContext(id);
  if (subCtxForAdd.status === 'EXPIRED' || subCtxForAdd.status === 'NONE') {
    return res.status(402).json({ error: 'SUBSCRIPTION_EXPIRED', message: 'Thời gian dùng thử đã kết thúc. Vui lòng nâng cấp gói để tiếp tục sử dụng.' });
  }
  const existing = await prisma.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId: id, userId: user.id } },
  });
  if (existing) return res.status(409).json({ error: 'ALREADY_MEMBER' });
  const memberCheck = await OrganizationQuota.canAddMember(id);
  if (!memberCheck.ok) {
    return res.status(422).json({ error: 'MEMBER_LIMIT_REACHED', message: 'Bạn đã sử dụng hết số thành viên của gói hiện tại.' });
  }
  const member = await prisma.organizationMember.create({
    data: { organizationId: id, userId: user.id, role: wantedRole, status: 'ACTIVE' },
  });
  res.json({ id: member.id, userId: user.id, email: user.email, name: user.name, role: member.role, status: member.status });
});

// Update member (role or status)
router.patch('/:id/members/:memberId', async (req: AuthRequest, res: Response) => {
  if (!req.userId) return res.status(401).json({ error: 'Unauthorized' });
  const id = String(req.params.id);
  const memberId = String(req.params.memberId);
  const requester = await prisma.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId: id, userId: req.userId } },
  });
  if (!requester || requester.status !== 'ACTIVE' || !roleAtLeast(requester.role as OrgRole, 'ADMIN')) {
    return res.status(403).json({ error: 'FORBIDDEN' });
  }
  const target = await prisma.organizationMember.findUnique({ where: { id: memberId } });
  if (!target || target.organizationId !== id) return res.status(404).json({ error: 'NOT_FOUND' });

  const { role, status } = req.body || {};
  const requestedRole = role && ['OWNER', 'ADMIN', 'MANAGER', 'MEMBER'].includes(role) ? role as OrgRole : undefined;
  if (!canManageMemberRole(requester.role as OrgRole, target.role as OrgRole, requestedRole)) {
    return res.status(403).json({ error: 'OWNER_ONLY' });
  }
  const data: Record<string, unknown> = {};
  if (requestedRole) data.role = requestedRole;
  if (status && ['ACTIVE', 'INVITED', 'DISABLED'].includes(status)) data.status = status;

  // Owner-safety: prevent leaving org with 0 active OWNERs
  const currentlyOwner = target.role === 'OWNER' && target.status === 'ACTIVE';
  const willBeOwner = (data.role ?? target.role) === 'OWNER' && (data.status ?? target.status) === 'ACTIVE';
  if (currentlyOwner && !willBeOwner) {
    const ownerCount = await prisma.organizationMember.count({
      where: { organizationId: id, role: 'OWNER', status: 'ACTIVE' },
    });
    if (removesLastActiveOwner(
      target.role as OrgRole,
      target.status,
      (data.role ?? target.role) as OrgRole,
      String(data.status ?? target.status),
      ownerCount,
    )) {
      return res.status(400).json({ error: 'LAST_OWNER', message: 'Không thể thay đổi OWNER cuối cùng của tổ chức.' });
    }
  }
  // Only OWNER may set/remove OWNER role
  // If member is being promoted to OWNER/ADMIN, force accessMode=ALL so we
  // never carry a stale RESTRICTED assignment for a privileged role.
  if (role === 'OWNER' || role === 'ADMIN') {
    (data as any).accessMode = 'ALL';
  }
  const updated = await prisma.organizationMember.update({ where: { id: memberId }, data });
  // Access rows for previous role are kept (spec: preserve for downgrade).
  try {
    const { emitMemberAccessChanged } = await import('../../realtime');
    emitMemberAccessChanged(target.userId, id);
  } catch { /* best-effort */ }
  res.json(updated);
});

// Remove member
router.delete('/:id/members/:memberId', async (req: AuthRequest, res: Response) => {
  if (!req.userId) return res.status(401).json({ error: 'Unauthorized' });
  const id = String(req.params.id);
  const memberId = String(req.params.memberId);
  const requester = await prisma.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId: id, userId: req.userId } },
  });
  if (!requester || requester.status !== 'ACTIVE' || !roleAtLeast(requester.role as OrgRole, 'ADMIN')) {
    return res.status(403).json({ error: 'FORBIDDEN' });
  }
  const target = await prisma.organizationMember.findUnique({ where: { id: memberId } });
  if (!target || target.organizationId !== id) return res.status(404).json({ error: 'NOT_FOUND' });
  if (!canManageMemberRole(requester.role as OrgRole, target.role as OrgRole)) {
    return res.status(403).json({ error: 'OWNER_ONLY' });
  }
  if (target.role === 'OWNER' && target.status === 'ACTIVE') {
    const ownerCount = await prisma.organizationMember.count({
      where: { organizationId: id, role: 'OWNER', status: 'ACTIVE' },
    });
    if (removesLastActiveOwner(target.role as OrgRole, target.status, 'MEMBER', 'DISABLED', ownerCount)) {
      return res.status(400).json({ error: 'LAST_OWNER', message: 'Không thể xoá OWNER cuối cùng.' });
    }
    if (requester.role !== 'OWNER') return res.status(403).json({ error: 'OWNER_ONLY' });
  }
  await prisma.organizationMember.delete({ where: { id: memberId } });
  res.json({ success: true });
});

// Subscription plans catalog
router.get('/plans/list', async (_req: AuthRequest, res: Response) => {
  const plans = await prisma.subscriptionPlan.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: 'asc' },
  });
  res.json(plans);
});

// Plan mutations live exclusively under /api/admin/plans/:id.
router.patch('/plans/:planId', (_req: AuthRequest, res: Response) => {
  res.status(404).json({ error: 'ADMIN_ENDPOINT_REQUIRED' });
});

// Customer subscription summary (any org member)
router.get('/:id/subscription', async (req: AuthRequest, res: Response) => {
  if (!req.userId) return res.status(401).json({ error: 'Unauthorized' });
  const id = String(req.params.id);
  const member = await prisma.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId: id, userId: req.userId } },
    select: { role: true, status: true },
  });
  if (!member || member.status !== 'ACTIVE') return res.status(403).json({ error: 'FORBIDDEN' });
  const [ctx, pageUsed, memberUsed] = await Promise.all([
    resolveSubscriptionContext(id),
    OrganizationQuota.getPageUsage(id),
    OrganizationQuota.getMemberUsage(id),
  ]);
  res.json({
    subscriptionStatus: ctx.status,
    isTrial: ctx.isTrial,
    trialStartedAt: ctx.trialStartedAt,
    trialEndsAt: ctx.trialEndsAt,
    trialDaysRemaining: ctx.trialDaysRemaining,
    expiresAt: ctx.expiresAt,
    planCode: ctx.planCode,
    planName: ctx.planName,
    pageUsage: { used: pageUsed, limit: ctx.pageLimit },
    memberUsage: { used: memberUsed, limit: ctx.memberLimit },
  });
});

// Subscription mutations live exclusively under /api/admin/organizations/:id/*.
router.put('/:id/subscription', (_req: AuthRequest, res: Response) => {
  res.status(404).json({ error: 'ADMIN_ENDPOINT_REQUIRED' });
});

// Organizations are never hard-deleted in V1 (lifecycle is ACTIVE/SUSPENDED only)
router.delete('/:id', (_req: AuthRequest, res: Response) => {
  res.status(405).json({ error: 'ORG_DELETE_DISABLED', message: 'Tổ chức không thể bị xoá.' });
});

// ---- Member access management ----

// GET current effective access for the requesting member (used by frontend to
// know whether to render restricted UI, etc.)
router.get('/:id/access/me', async (req: AuthRequest, res: Response) => {
  if (!req.userId) return res.status(401).json({ error: 'Unauthorized' });
  const id = String(req.params.id);
  const m = await prisma.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId: id, userId: req.userId } },
    select: { id: true, role: true, accessMode: true, status: true },
  });
  if (!m || m.status !== 'ACTIVE') return res.status(403).json({ error: 'FORBIDDEN' });
  const role = m.role as OrgRole;
  const isAllAccess = role === 'OWNER' || role === 'ADMIN' || m.accessMode === 'ALL';
  const { getAccessiblePageIds, getAccessibleWorkspaceIds } = await import('../access');
  const ctx = { organizationId: id, userId: req.userId, role, accessMode: m.accessMode as 'ALL'|'RESTRICTED', memberId: m.id, isAllAccess };
  const [pages, workspaces] = await Promise.all([
    getAccessiblePageIds(ctx),
    getAccessibleWorkspaceIds(ctx),
  ]);
  res.json({ role, accessMode: m.accessMode, isAllAccess, pageIds: pages, workspaceIds: workspaces });
});

// GET a specific member's access (admin+)
router.get('/:id/members/:memberId/access', async (req: AuthRequest, res: Response) => {
  if (!req.userId) return res.status(401).json({ error: 'Unauthorized' });
  const id = String(req.params.id);
  const memberId = String(req.params.memberId);
  const requester = await prisma.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId: id, userId: req.userId } },
  });
  if (!requester || requester.status !== 'ACTIVE' || !roleAtLeast(requester.role as OrgRole, 'ADMIN')) return res.status(403).json({ error: 'FORBIDDEN' });
  const target = await prisma.organizationMember.findUnique({
    where: { id: memberId },
    include: {
      workspaceGrants: { select: { workspaceId: true } },
      pageGrants: { select: { pageId: true } },
    },
  }) as any;
  if (!target || target.organizationId !== id) return res.status(404).json({ error: 'NOT_FOUND' });
  res.json({
    memberId: target.id,
    role: target.role,
    accessMode: target.accessMode,
    workspaceIds: target.workspaceGrants.map((g: any) => g.workspaceId),
    pageIds: target.pageGrants.map((g: any) => g.pageId),
  });
});

// PUT update a member's access (admin+). OWNER/ADMIN can never be RESTRICTED.
router.put('/:id/members/:memberId/access', async (req: AuthRequest, res: Response) => {
  if (!req.userId) return res.status(401).json({ error: 'Unauthorized' });
  const id = String(req.params.id);
  const memberId = String(req.params.memberId);
  const requester = await prisma.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId: id, userId: req.userId } },
  });
  if (!requester || requester.status !== 'ACTIVE' || !roleAtLeast(requester.role as OrgRole, 'ADMIN')) return res.status(403).json({ error: 'FORBIDDEN' });
  const target = await prisma.organizationMember.findUnique({ where: { id: memberId } });
  if (!target || target.organizationId !== id) return res.status(404).json({ error: 'NOT_FOUND' });
  if (!canManageMemberRole(requester.role as OrgRole, target.role as OrgRole)) {
    return res.status(403).json({ error: 'OWNER_ONLY' });
  }

  const { accessMode, workspaceIds, pageIds } = req.body || {};
  const wantedMode: 'ALL' | 'RESTRICTED' = accessMode === 'RESTRICTED' ? 'RESTRICTED' : 'ALL';

  // OWNER/ADMIN are always ALL — reject attempts to restrict them.
  if ((target.role === 'OWNER' || target.role === 'ADMIN') && wantedMode === 'RESTRICTED') {
    return res.status(400).json({ error: 'CANNOT_RESTRICT_OWNER_ADMIN', message: 'Owner/Admin luôn có toàn quyền tổ chức.' });
  }

  const wsIds: string[] = Array.isArray(workspaceIds) ? workspaceIds.filter((x) => typeof x === 'string') : [];
  const pgIds: string[] = Array.isArray(pageIds) ? pageIds.filter((x) => typeof x === 'string') : [];

  // Validate all resources belong to this org.
  if (wsIds.length) {
    const wsCount = await prisma.workspace.count({ where: { id: { in: wsIds }, organizationId: id } });
    if (wsCount !== wsIds.length) return res.status(400).json({ error: 'INVALID_WORKSPACES' });
  }
  if (pgIds.length) {
    const pgCount = await prisma.page.count({ where: { id: { in: pgIds }, organizationId: id } });
    if (pgCount !== pgIds.length) return res.status(400).json({ error: 'INVALID_PAGES' });
  }

  await prisma.$transaction(async (tx) => {
    await tx.organizationMember.update({ where: { id: memberId }, data: { accessMode: wantedMode } });
    await tx.organizationMemberWorkspace.deleteMany({ where: { organizationMemberId: memberId } });
    await tx.organizationMemberPage.deleteMany({ where: { organizationMemberId: memberId } });
    if (wantedMode === 'RESTRICTED') {
      if (wsIds.length) {
        await tx.organizationMemberWorkspace.createMany({
          data: wsIds.map((wid) => ({ organizationMemberId: memberId, workspaceId: wid })),
        });
      }
      if (pgIds.length) {
        await tx.organizationMemberPage.createMany({
          data: pgIds.map((pid) => ({ organizationMemberId: memberId, pageId: pid })),
        });
      }
    }
  });

  // Notify the affected member via realtime so their client can reconcile scope.
  try {
    const { emitMemberAccessChanged } = await import('../../realtime');
    emitMemberAccessChanged(target.userId, id);
  } catch { /* best-effort */ }

  res.json({ success: true, memberId, accessMode: wantedMode, workspaceIds: wsIds, pageIds: pgIds });
});

// Page usage endpoint (any member)
router.get('/:id/page-usage', async (req: AuthRequest, res: Response) => {
  if (!req.userId) return res.status(401).json({ error: 'Unauthorized' });
  const id = String(req.params.id);
  const requester = await prisma.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId: id, userId: req.userId } },
  });
  if (!requester || requester.status !== 'ACTIVE') return res.status(403).json({ error: 'FORBIDDEN' });
  const [used, limit] = await Promise.all([
    OrganizationQuota.getPageUsage(id),
    OrganizationQuota.getPageLimit(id),
  ]);
  res.json({ used, limit, overLimit: limit != null && used > limit });
});

export { router as organizationRouter };

/**
 * Create a customer Organization for `userId` (OWNER) and its subscription.
 * Trial is granted only if the policy is enabled and the user has never consumed one;
 * the unique user_trial_entitlements row is the atomic guard (invoked once per user).
 */
export async function provisionOrganizationForOwner(userId: string, name: string) {
  const org = await prisma.organization.create({
    data: { name, ownerUserId: userId, status: 'ACTIVE', members: { create: { userId, role: 'OWNER', status: 'ACTIVE' } } },
  });
  const starter = await prisma.subscriptionPlan.findUnique({ where: { code: 'STARTER_3' } });
  if (!starter) return { org, trial: false };
  const policy = await getTrialPolicy();
  let trial = false;
  if (policy.trialEnabled) {
    try {
      await prisma.userTrialEntitlement.create({ data: { id: `ute_${userId}`, userId, organizationId: org.id } });
      trial = true;
    } catch (e: any) { if (e?.code !== 'P2002') throw e; }
  }
  if (trial) {
    const now = new Date();
    await prisma.organizationSubscription.create({
      data: { organizationId: org.id, planId: starter.id, status: 'TRIAL', trialStartedAt: now, trialEndsAt: new Date(now.getTime() + policy.trialDays * DAY_MS) },
    });
  } else {
    await prisma.organizationSubscription.create({ data: { organizationId: org.id, planId: starter.id, status: 'ACTIVE' } });
  }
  return { org, trial };
}
