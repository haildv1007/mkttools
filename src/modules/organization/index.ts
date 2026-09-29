import { Router, Response, NextFunction } from 'express';
import { prisma } from '../../utils/db';
import { AuthRequest } from '../../middleware/auth';

export type OrgRole = 'OWNER' | 'ADMIN' | 'MANAGER' | 'MEMBER';

const ROLE_RANK: Record<OrgRole, number> = { OWNER: 4, ADMIN: 3, MANAGER: 2, MEMBER: 1 };

export function roleAtLeast(role: OrgRole | undefined, min: OrgRole): boolean {
  if (!role) return false;
  return ROLE_RANK[role] >= ROLE_RANK[min];
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

export async function resolveCurrentOrganization(userId: string, requested?: string | null) {
  const memberships = await listMemberships(userId);
  const active = memberships.filter((m) => m.organization.status === 'ACTIVE');
  if (active.length === 0) return { memberships, current: null as null | typeof active[0] };
  let current = active[0];
  if (requested) {
    const found = active.find((m) => m.organizationId === requested);
    if (found) current = found;
  }
  return { memberships, current };
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
  const requested = (req.header('x-organization-id') || req.query.orgId || '').toString() || null;
  const { current } = await resolveCurrentOrganization(req.userId, requested);
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

// ---------------- Quota service ----------------

export const OrganizationQuota = {
  async getPageLimit(orgId: string): Promise<number | null> {
    const sub = (await prisma.organizationSubscription.findFirst({
      where: { organizationId: orgId, status: 'ACTIVE' },
      include: { plan: true },
      orderBy: { startedAt: 'desc' },
    })) as any;
    if (!sub) return 0;
    if (sub.customMaxPages != null) return sub.customMaxPages;
    return sub.plan?.maxPages ?? null;
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
  const requested = (req.header('x-organization-id') || req.query.orgId || '').toString() || null;
  const { memberships, current } = await resolveCurrentOrganization(req.userId, requested);
  if (!current) return res.json({ current: null, memberships: [] });
  const [limit, used, subRaw] = await Promise.all([
    OrganizationQuota.getPageLimit(current.organizationId),
    OrganizationQuota.getPageUsage(current.organizationId),
    prisma.organizationSubscription.findFirst({
      where: { organizationId: current.organizationId, status: 'ACTIVE' },
      include: { plan: true },
      orderBy: { startedAt: 'desc' },
    }),
  ]);
  const sub = subRaw as any;
  res.json({
    current: {
      id: current.organization.id,
      name: current.organization.name,
      slug: current.organization.slug,
      role: current.role,
      isOwner: current.organization.ownerUserId === req.userId,
    },
    memberships: memberships.map((m) => ({
      id: m.organization.id,
      name: m.organization.name,
      role: m.role,
      status: m.organization.status,
    })),
    subscription: sub ? {
      planCode: sub.plan.code,
      planName: sub.plan.name,
      status: sub.status,
      expiresAt: sub.expiresAt,
      customMaxPages: sub.customMaxPages,
    } : null,
    pageUsage: { used, limit },
  });
});

// Update organization (name)
router.patch('/:id', async (req: AuthRequest, res: Response) => {
  if (!req.userId) return res.status(401).json({ error: 'Unauthorized' });
  const id = String(req.params.id);
  const member = await prisma.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId: id, userId: req.userId } },
  });
  if (!member || !roleAtLeast(member.role as OrgRole, 'ADMIN')) {
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
  if (!requester) return res.status(403).json({ error: 'FORBIDDEN' });
  const members = await prisma.organizationMember.findMany({
    where: { organizationId: id },
    include: { user: { select: { id: true, email: true, name: true } } },
    orderBy: { createdAt: 'asc' },
  });
  res.json(members.map((m: any) => ({
    id: m.id,
    userId: m.userId,
    email: m.user.email,
    name: m.user.name,
    role: m.role,
    status: m.status,
    createdAt: m.createdAt,
  })));
});

// Add existing user to organization by email
router.post('/:id/members', async (req: AuthRequest, res: Response) => {
  if (!req.userId) return res.status(401).json({ error: 'Unauthorized' });
  const id = String(req.params.id);
  const requester = await prisma.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId: id, userId: req.userId } },
  });
  if (!requester || !roleAtLeast(requester.role as OrgRole, 'ADMIN')) {
    return res.status(403).json({ error: 'FORBIDDEN' });
  }
  const { email, role } = req.body || {};
  const wantedRole: OrgRole = ['ADMIN', 'MANAGER', 'MEMBER'].includes(role) ? role : 'MEMBER';
  const user = await prisma.user.findUnique({ where: { email: String(email || '').trim().toLowerCase() } });
  if (!user) return res.status(404).json({ error: 'USER_NOT_FOUND', message: 'Không tìm thấy user với email này.' });
  const existing = await prisma.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId: id, userId: user.id } },
  });
  if (existing) return res.status(409).json({ error: 'ALREADY_MEMBER' });
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
  if (!requester || !roleAtLeast(requester.role as OrgRole, 'ADMIN')) {
    return res.status(403).json({ error: 'FORBIDDEN' });
  }
  const target = await prisma.organizationMember.findUnique({ where: { id: memberId } });
  if (!target || target.organizationId !== id) return res.status(404).json({ error: 'NOT_FOUND' });

  const { role, status } = req.body || {};
  const data: Record<string, unknown> = {};
  if (role && ['OWNER', 'ADMIN', 'MANAGER', 'MEMBER'].includes(role)) data.role = role;
  if (status && ['ACTIVE', 'INVITED', 'DISABLED'].includes(status)) data.status = status;

  // Owner-safety: prevent leaving org with 0 active OWNERs
  const currentlyOwner = target.role === 'OWNER' && target.status === 'ACTIVE';
  const willBeOwner = (data.role ?? target.role) === 'OWNER' && (data.status ?? target.status) === 'ACTIVE';
  if (currentlyOwner && !willBeOwner) {
    const ownerCount = await prisma.organizationMember.count({
      where: { organizationId: id, role: 'OWNER', status: 'ACTIVE' },
    });
    if (ownerCount <= 1) {
      return res.status(400).json({ error: 'LAST_OWNER', message: 'Không thể thay đổi OWNER cuối cùng của tổ chức.' });
    }
  }
  // Only OWNER may set/remove OWNER role
  if ((role === 'OWNER' || target.role === 'OWNER') && requester.role !== 'OWNER') {
    return res.status(403).json({ error: 'OWNER_ONLY' });
  }

  const updated = await prisma.organizationMember.update({ where: { id: memberId }, data });
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
  if (!requester || !roleAtLeast(requester.role as OrgRole, 'ADMIN')) {
    return res.status(403).json({ error: 'FORBIDDEN' });
  }
  const target = await prisma.organizationMember.findUnique({ where: { id: memberId } });
  if (!target || target.organizationId !== id) return res.status(404).json({ error: 'NOT_FOUND' });
  if (target.role === 'OWNER' && target.status === 'ACTIVE') {
    const ownerCount = await prisma.organizationMember.count({
      where: { organizationId: id, role: 'OWNER', status: 'ACTIVE' },
    });
    if (ownerCount <= 1) {
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

// Assign / change plan for org (ADMIN+)
router.put('/:id/subscription', async (req: AuthRequest, res: Response) => {
  if (!req.userId) return res.status(401).json({ error: 'Unauthorized' });
  const id = String(req.params.id);
  const requester = await prisma.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId: id, userId: req.userId } },
  });
  if (!requester || !roleAtLeast(requester.role as OrgRole, 'OWNER')) {
    return res.status(403).json({ error: 'OWNER_ONLY' });
  }
  const { planCode, customMaxPages, expiresAt } = req.body || {};
  const plan = await prisma.subscriptionPlan.findUnique({ where: { code: String(planCode) } });
  if (!plan) return res.status(404).json({ error: 'PLAN_NOT_FOUND' });
  // Cancel existing active subs
  await prisma.organizationSubscription.updateMany({
    where: { organizationId: id, status: 'ACTIVE' },
    data: { status: 'CANCELLED' },
  });
  const sub = (await prisma.organizationSubscription.create({
    data: {
      organizationId: id,
      planId: plan.id,
      status: 'ACTIVE',
      customMaxPages: customMaxPages != null ? Number(customMaxPages) : null,
      expiresAt: expiresAt ? new Date(expiresAt) : null,
    },
    include: { plan: true },
  })) as any;
  res.json({
    planCode: sub.plan.code,
    planName: sub.plan.name,
    status: sub.status,
    expiresAt: sub.expiresAt,
    customMaxPages: sub.customMaxPages,
  });
});

// Page usage endpoint (any member)
router.get('/:id/page-usage', async (req: AuthRequest, res: Response) => {
  if (!req.userId) return res.status(401).json({ error: 'Unauthorized' });
  const id = String(req.params.id);
  const requester = await prisma.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId: id, userId: req.userId } },
  });
  if (!requester) return res.status(403).json({ error: 'FORBIDDEN' });
  const [used, limit] = await Promise.all([
    OrganizationQuota.getPageUsage(id),
    OrganizationQuota.getPageLimit(id),
  ]);
  res.json({ used, limit, overLimit: limit != null && used > limit });
});

export { router as organizationRouter };
