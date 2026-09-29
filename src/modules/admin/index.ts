import { Router, Response, NextFunction } from 'express';
import { prisma } from '../../utils/db';
import { AuthRequest } from '../../middleware/auth';
import {
  isPlatformAdmin, getTrialPolicy, contextFromSubscription, pickCurrentSubscription, resolveSubscriptionContext, OrgRole,
} from '../organization';
import { getAccessiblePageIds } from '../access';
import { logActivity } from '../../utils/activity';
import { billingAdminRouter } from '../billing';
import { platformSettingsAdminRouter } from '../platform-settings';

const DAY_MS = 24 * 3600 * 1000;

/** Backend guard: every /api/admin route requires users.is_platform_admin. */
export async function requirePlatformAdmin(req: AuthRequest, res: Response, next: NextFunction) {
  if (!(await isPlatformAdmin(req.userId))) {
    return res.status(403).json({ error: 'PLATFORM_ADMIN_REQUIRED', message: 'Chỉ Platform Admin được truy cập.' });
  }
  next();
}

const router = Router();
router.use(requirePlatformAdmin);

// ---------- helpers ----------

function intOrNull(v: unknown, min = 0): number | null {
  if (v === null || v === '' || v === undefined) return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min) throw new BadInput('Giá trị số không hợp lệ.');
  return n;
}
class BadInput extends Error {}
function bad(res: Response, e: unknown) {
  if (e instanceof BadInput) return res.status(400).json({ error: 'INVALID_INPUT', message: e.message });
  throw e;
}
function parseDate(v: unknown): Date | null {
  if (!v) return null;
  const d = new Date(String(v));
  if (isNaN(d.getTime())) throw new BadInput('Ngày không hợp lệ.');
  return d;
}

/**
 * Extension rule: if the current end date is still in the future, extend from
 * it; otherwise extend from now. Deterministic given (current, now, days).
 */
export function extendFrom(current: Date | null, days: number, now = new Date()): Date {
  const base = current && current.getTime() > now.getTime() ? current : now;
  return new Date(base.getTime() + days * DAY_MS);
}

async function adminLog(req: AuthRequest, orgId: string | null, action: string, summary: string) {
  await logActivity({ organizationId: orgId, action, category: 'admin', status: 'success', summary,
    detail: `by ${req.userId}`, entityType: 'organization', entityId: orgId ?? undefined });
}

interface OrgRow {
  id: string; name: string; status: string; createdAt: Date;
  owner: { id: string; name: string; email: string } | null;
  pages: number; members: number; workspaces: number;
  subscriptionStatus: string; isTrial: boolean; planCode: string | null; planName: string | null;
  expiresAt: Date | null; trialEndsAt: Date | null; trialDaysRemaining: number | null;
  startedAt: Date | null;
  pageLimit: number | null; memberLimit: number | null;
  customMaxPages: number | null; customMaxMembers: number | null;
  overPages: boolean; overMembers: boolean;
}

/** All orgs with aggregates in a constant number of queries (no per-org queries). */
async function loadOrgRows(): Promise<OrgRow[]> {
  const [orgs, pageCounts, memberCounts, wsCounts, subs, policy] = await Promise.all([
    prisma.organization.findMany({ include: { owner: { select: { id: true, name: true, email: true } } } }),
    prisma.page.groupBy({ by: ['organizationId'], where: { isActive: true }, _count: { _all: true } }),
    prisma.organizationMember.groupBy({ by: ['organizationId'], where: { status: 'ACTIVE' }, _count: { _all: true } }),
    prisma.workspace.groupBy({ by: ['organizationId'], _count: { _all: true } }),
    prisma.organizationSubscription.findMany({ include: { plan: true } }),
    getTrialPolicy(),
  ]);
  const pc = new Map(pageCounts.map((r) => [r.organizationId, r._count._all]));
  const mc = new Map(memberCounts.map((r) => [r.organizationId, r._count._all]));
  const wc = new Map(wsCounts.map((r) => [r.organizationId, r._count._all]));
  const subsByOrg = new Map<string, any[]>();
  for (const s of subs as any[]) {
    const arr = subsByOrg.get(s.organizationId) ?? [];
    arr.push(s); subsByOrg.set(s.organizationId, arr);
  }
  const now = new Date();
  return orgs.map((o) => {
    const ctx = contextFromSubscription(pickCurrentSubscription(subsByOrg.get(o.id) ?? []), policy, now);
    const pages = pc.get(o.id) ?? 0; const members = mc.get(o.id) ?? 0;
    return {
      id: o.id, name: o.name, status: o.status, createdAt: o.createdAt, owner: o.owner,
      pages, members, workspaces: wc.get(o.id) ?? 0,
      subscriptionStatus: ctx.status, isTrial: ctx.isTrial, planCode: ctx.planCode, planName: ctx.planName,
      expiresAt: ctx.isTrial ? ctx.trialEndsAt : ctx.expiresAt, trialEndsAt: ctx.trialEndsAt,
      trialDaysRemaining: ctx.trialDaysRemaining, startedAt: ctx.startedAt,
      pageLimit: ctx.pageLimit, memberLimit: ctx.memberLimit,
      customMaxPages: ctx.customMaxPages, customMaxMembers: ctx.customMaxMembers,
      overPages: ctx.pageLimit != null && pages > ctx.pageLimit,
      overMembers: ctx.memberLimit != null && members > ctx.memberLimit,
    };
  });
}

function paginate<T>(rows: T[], q: any) {
  const pageSize = [25, 50, 100].includes(Number(q.pageSize)) ? Number(q.pageSize) : 25;
  const page = Math.max(1, Number(q.page) || 1);
  return { total: rows.length, page, pageSize, items: rows.slice((page - 1) * pageSize, page * pageSize) };
}

// ---------- overview ----------

router.get('/overview', async (_req: AuthRequest, res: Response) => {
  const [rows, users, pages] = await Promise.all([
    loadOrgRows(), prisma.user.count(), prisma.page.count({ where: { isActive: true } }),
  ]);
  res.json({
    kpis: {
      organizations: rows.length, users, connectedPages: pages,
      activeSubscriptions: rows.filter((r) => r.subscriptionStatus === 'ACTIVE').length,
      trials: rows.filter((r) => r.subscriptionStatus === 'TRIAL').length,
      expiredSubscriptions: rows.filter((r) => r.subscriptionStatus === 'EXPIRED' || r.subscriptionStatus === 'NONE').length,
      suspendedOrganizations: rows.filter((r) => r.status === 'SUSPENDED').length,
    },
    recentOrganizations: [...rows].sort((a, b) => +b.createdAt - +a.createdAt).slice(0, 10),
  });
});

// ---------- organizations ----------

router.get('/organizations', async (req: AuthRequest, res: Response) => {
  const q = req.query as Record<string, string>;
  let rows = await loadOrgRows();
  const term = (q.q || '').trim().toLowerCase();
  if (term) rows = rows.filter((r) => r.name.toLowerCase().includes(term) || (r.owner?.email || '').toLowerCase().includes(term));
  if (q.orgStatus) rows = rows.filter((r) => r.status === q.orgStatus);
  if (q.subStatus) rows = rows.filter((r) => r.subscriptionStatus === q.subStatus);
  if (q.plan) rows = rows.filter((r) => r.planCode === q.plan);
  if (q.trial === '1') rows = rows.filter((r) => r.isTrial);
  if (q.overPages === '1') rows = rows.filter((r) => r.overPages);
  if (q.overMembers === '1') rows = rows.filter((r) => r.overMembers);
  const keyOf: Record<string, (r: OrgRow) => number> = {
    created: (r) => +r.createdAt, expires: (r) => (r.expiresAt ? +r.expiresAt : Infinity),
    pages: (r) => r.pages, members: (r) => r.members,
  };
  const key = keyOf[q.sort] ?? keyOf.created;
  const dir = q.dir === 'asc' ? 1 : -1;
  rows.sort((a, b) => (key(a) - key(b) || 0) * dir);
  res.json(paginate(rows, q));
});

router.get('/organizations/:id', async (req: AuthRequest, res: Response) => {
  const id = String(req.params.id);
  const org = await prisma.organization.findUnique({
    where: { id }, include: { owner: { select: { id: true, name: true, email: true } } },
  });
  if (!org) return res.status(404).json({ error: 'NOT_FOUND' });
  const [ctx, subs, members, pages, workspaces, campaigns, contentItems] = await Promise.all([
    resolveSubscriptionContext(id),
    prisma.organizationSubscription.findMany({ where: { organizationId: id }, include: { plan: true }, orderBy: { startedAt: 'desc' } }),
    prisma.organizationMember.findMany({
      where: { organizationId: id }, include: {
        user: { select: { id: true, name: true, email: true } },
        workspaceGrants: { select: { workspaceId: true } },
      }, orderBy: { createdAt: 'asc' },
    }),
    // select list deliberately excludes accessToken
    prisma.page.findMany({
      where: { organizationId: id },
      select: { id: true, name: true, platform: true, externalId: true, isActive: true, createdAt: true,
        workspacePages: { select: { workspace: { select: { name: true } } } } },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.workspace.findMany({
      where: { organizationId: id },
      select: { id: true, name: true, createdAt: true, _count: { select: { workspacePages: true, memberGrants: true } } },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.campaign.count({ where: { organizationId: id } }),
    prisma.contentItem.count({ where: { organizationId: id } }),
  ]);
  const activeMembers = members.filter((m) => m.status === 'ACTIVE').length;
  const allAccess = members.filter((m) => m.status === 'ACTIVE' && (m.role === 'OWNER' || m.role === 'ADMIN' || m.accessMode === 'ALL')).length;
  const memberRows = await Promise.all(members.map(async (m) => {
    const isAll = m.role === 'OWNER' || m.role === 'ADMIN' || m.accessMode === 'ALL';
    const pageCount = isAll ? null : (await getAccessiblePageIds({
      organizationId: id, userId: m.userId, role: m.role as OrgRole, accessMode: 'RESTRICTED', memberId: m.id, isAllAccess: false,
    })).length;
    return { id: m.id, name: m.user.name, email: m.user.email, role: m.role, status: m.status,
      isAllAccess: isAll, workspaceCount: m.workspaceGrants.length, pageCount, joinedAt: m.createdAt };
  }));
  const activePages = pages.filter((p) => p.isActive).length;
  res.json({
    organization: { id: org.id, name: org.name, status: org.status, createdAt: org.createdAt, owner: org.owner },
    subscription: {
      status: ctx.status, isTrial: ctx.isTrial, planCode: ctx.planCode, planName: ctx.planName,
      startedAt: ctx.startedAt, expiresAt: ctx.expiresAt, trialStartedAt: ctx.trialStartedAt, trialEndsAt: ctx.trialEndsAt,
      trialDaysRemaining: ctx.trialDaysRemaining,
      planMaxPages: ctx.planMaxPages, planMaxMembers: ctx.planMaxMembers,
      customMaxPages: ctx.customMaxPages, customMaxMembers: ctx.customMaxMembers,
      pageLimit: ctx.pageLimit, memberLimit: ctx.memberLimit,
      history: subs.map((s: any) => ({ id: s.id, status: s.status, planCode: s.plan?.code, startedAt: s.startedAt, expiresAt: s.expiresAt })),
    },
    usage: {
      pages: activePages, members: activeMembers,
      overPages: ctx.pageLimit != null && activePages > ctx.pageLimit,
      overMembers: ctx.memberLimit != null && activeMembers > ctx.memberLimit,
    },
    counts: { pages: pages.length, members: members.length, workspaces: workspaces.length, campaigns, content: contentItems },
    members: memberRows,
    pages: pages.map((p) => ({ id: p.id, name: p.name, platform: p.platform, externalId: p.externalId, isActive: p.isActive,
      createdAt: p.createdAt, workspaces: p.workspacePages.map((w) => w.workspace.name) })),
    workspaces: workspaces.map((w) => ({ id: w.id, name: w.name, createdAt: w.createdAt, pageCount: w._count.workspacePages,
      memberCount: w._count.memberGrants + allAccess })),
  });
});

// Current subscription row for mutation (in place, no history rewrite beyond the row itself).
async function currentSub(orgId: string) {
  const subs = (await prisma.organizationSubscription.findMany({ where: { organizationId: orgId }, include: { plan: true } })) as any[];
  return pickCurrentSubscription(subs);
}

// Change plan. TRIAL/EXPIRED/CANCELLED -> ACTIVE on the chosen plan. Data untouched.
router.put('/organizations/:id/plan', async (req: AuthRequest, res: Response) => {
  try {
    const id = String(req.params.id);
    const org = await prisma.organization.findUnique({ where: { id }, select: { id: true, name: true } });
    if (!org) return res.status(404).json({ error: 'NOT_FOUND' });
    const plan = await prisma.subscriptionPlan.findUnique({ where: { code: String(req.body?.planCode || '') } });
    if (!plan) return res.status(404).json({ error: 'PLAN_NOT_FOUND' });
    const startedAt = parseDate(req.body?.startedAt) ?? new Date();
    const expiresAt = req.body?.expiresAt === undefined ? undefined : parseDate(req.body.expiresAt);
    const sub = await currentSub(id);
    let out: any;
    if (sub) {
      out = await prisma.organizationSubscription.update({
        where: { id: sub.id },
        data: { planId: plan.id, status: 'ACTIVE', startedAt: sub.status === 'ACTIVE' && !req.body?.startedAt ? undefined : startedAt,
          ...(expiresAt !== undefined ? { expiresAt } : sub.status !== 'ACTIVE' ? { expiresAt: null } : {}) },
        include: { plan: true },
      });
    } else {
      out = await prisma.organizationSubscription.create({
        data: { organizationId: id, planId: plan.id, status: 'ACTIVE', startedAt, expiresAt: expiresAt ?? null }, include: { plan: true },
      });
    }
    await adminLog(req, id, 'admin.plan_changed', `Đổi gói ${org.name}: ${sub?.status ?? 'NONE'}/${sub?.plan?.code ?? '-'} → ACTIVE/${plan.code}`);
    res.json({ ok: true, status: out.status, planCode: out.plan.code, startedAt: out.startedAt, expiresAt: out.expiresAt });
  } catch (e) { return bad(res, e); }
});

// Custom limits. Key absent = unchanged; null = clear override.
router.put('/organizations/:id/limits', async (req: AuthRequest, res: Response) => {
  try {
    const id = String(req.params.id);
    const sub = await currentSub(id);
    if (!sub) return res.status(404).json({ error: 'NO_SUBSCRIPTION' });
    const data: Record<string, number | null> = {};
    if ('customMaxPages' in (req.body || {})) data.customMaxPages = intOrNull(req.body.customMaxPages);
    if ('customMaxMembers' in (req.body || {})) data.customMaxMembers = intOrNull(req.body.customMaxMembers);
    await prisma.organizationSubscription.update({ where: { id: sub.id }, data });
    await adminLog(req, id, 'admin.limits_changed', `Giới hạn tùy chỉnh: ${JSON.stringify(data)}`);
    const ctx = await resolveSubscriptionContext(id);
    res.json({ ok: true, pageLimit: ctx.pageLimit, memberLimit: ctx.memberLimit });
  } catch (e) { return bad(res, e); }
});

// Dates: {days} extends; {expiresAt} sets; {startedAt} sets start.
router.put('/organizations/:id/dates', async (req: AuthRequest, res: Response) => {
  try {
    const id = String(req.params.id);
    const sub = await currentSub(id);
    if (!sub) return res.status(404).json({ error: 'NO_SUBSCRIPTION' });
    const { days } = req.body || {};
    const data: Record<string, any> = {};
    const revivedTrial = sub.status === 'EXPIRED' && sub.trialStartedAt && !sub.expiresAt && sub.trialEndsAt;
    const isTrialLike = sub.status === 'TRIAL' || revivedTrial;
    const endField = isTrialLike ? 'trialEndsAt' : 'expiresAt';
    if (days != null) {
      const n = Number(days);
      if (!Number.isInteger(n) || n < 1 || n > 3650) throw new BadInput('Số ngày không hợp lệ.');
      data[endField] = extendFrom(sub[endField] ?? null, n);
      if (revivedTrial) data.status = 'TRIAL';
    } else if (req.body?.expiresAt !== undefined) {
      data[endField] = parseDate(req.body.expiresAt);
      if (revivedTrial && data[endField] && data[endField] > new Date()) data.status = 'TRIAL';
    }
    if (req.body?.startedAt) data.startedAt = parseDate(req.body.startedAt);
    if (!Object.keys(data).length) throw new BadInput('Không có thay đổi.');
    const out = await prisma.organizationSubscription.update({ where: { id: sub.id }, data });
    await adminLog(req, id, 'admin.subscription_dates', `Cập nhật ngày subscription: ${endField}=${(out as any)[endField]?.toISOString?.() ?? 'null'}`);
    res.json({ ok: true, status: out.status, startedAt: out.startedAt, expiresAt: out.expiresAt, trialEndsAt: out.trialEndsAt });
  } catch (e) { return bad(res, e); }
});

// Status: ACTIVE | EXPIRED | CANCELLED. Trial->paid goes through /plan.
router.put('/organizations/:id/subscription-status', async (req: AuthRequest, res: Response) => {
  try {
    const id = String(req.params.id);
    const status = String(req.body?.status || '');
    if (!['ACTIVE', 'EXPIRED', 'CANCELLED'].includes(status)) throw new BadInput('Trạng thái không hợp lệ.');
    const sub = await currentSub(id);
    if (!sub) return res.status(404).json({ error: 'NO_SUBSCRIPTION' });
    const data: Record<string, any> = { status };
    if (status === 'ACTIVE') {
      if (sub.status === 'TRIAL') throw new BadInput('Dùng "Đổi gói" để chuyển Trial sang gói trả phí.');
      if (req.body?.expiresAt !== undefined) data.expiresAt = parseDate(req.body.expiresAt);
      const exp = 'expiresAt' in data ? data.expiresAt : sub.expiresAt;
      if (exp && exp <= new Date()) throw new BadInput('Ngày hết hạn đã qua. Hãy gia hạn hoặc đặt ngày hết hạn mới.');
    }
    await prisma.organizationSubscription.update({ where: { id: sub.id }, data });
    await adminLog(req, id, 'admin.subscription_status', `Subscription ${sub.status} → ${status}`);
    res.json({ ok: true, status });
  } catch (e) { return bad(res, e); }
});

router.post('/organizations/:id/suspend', async (req: AuthRequest, res: Response) => setOrgStatus(req, res, 'SUSPENDED'));
router.post('/organizations/:id/reactivate', async (req: AuthRequest, res: Response) => setOrgStatus(req, res, 'ACTIVE'));
async function setOrgStatus(req: AuthRequest, res: Response, status: 'ACTIVE' | 'SUSPENDED') {
  const id = String(req.params.id);
  const org = await prisma.organization.findUnique({ where: { id }, select: { id: true } });
  if (!org) return res.status(404).json({ error: 'NOT_FOUND' });
  await prisma.organization.update({ where: { id }, data: { status } });
  await adminLog(req, id, status === 'SUSPENDED' ? 'admin.org_suspended' : 'admin.org_reactivated', `Organization → ${status}`);
  res.json({ ok: true, status });
}

// ---------- plans / subscriptions ----------

router.get('/plans', async (_req: AuthRequest, res: Response) => {
  const [plans, counts] = await Promise.all([
    prisma.subscriptionPlan.findMany({ orderBy: { sortOrder: 'asc' } }),
    prisma.organizationSubscription.groupBy({ by: ['planId'], where: { status: 'ACTIVE' }, _count: { _all: true } }),
  ]);
  const c = new Map(counts.map((r) => [r.planId, r._count._all]));
  res.json(plans.map((p) => ({ id: p.id, code: p.code, name: p.name, maxPages: p.maxPages, maxMembers: p.maxMembers,
    isActive: p.isActive, sortOrder: p.sortOrder, organizations: c.get(p.id) ?? 0 })));
});

router.patch('/plans/:id', async (req: AuthRequest, res: Response) => {
  try {
    const id = String(req.params.id);
    const plan = await prisma.subscriptionPlan.findUnique({ where: { id } });
    if (!plan) return res.status(404).json({ error: 'PLAN_NOT_FOUND' });
    const b = req.body || {}; const data: Record<string, any> = {};
    if (b.name != null) { const n = String(b.name).trim(); if (!n) throw new BadInput('Tên gói trống.'); data.name = n; }
    if ('maxPages' in b) data.maxPages = intOrNull(b.maxPages);
    if ('maxMembers' in b) data.maxMembers = intOrNull(b.maxMembers);
    if (b.isActive != null) data.isActive = Boolean(b.isActive);
    if (b.sortOrder != null) data.sortOrder = intOrNull(b.sortOrder, -100000) ?? 0;
    const out = await prisma.subscriptionPlan.update({ where: { id }, data });
    await adminLog(req, null, 'admin.plan_edited', `Sửa gói ${plan.code}: ${JSON.stringify(data)}`);
    res.json(out);
  } catch (e) { return bad(res, e); }
});

router.get('/subscriptions', async (req: AuthRequest, res: Response) => {
  const q = req.query as Record<string, string>;
  let rows = await loadOrgRows();
  const now = Date.now();
  if (q.status) rows = rows.filter((r) => r.subscriptionStatus === q.status);
  if (q.plan) rows = rows.filter((r) => r.planCode === q.plan);
  if (q.trial === '1') rows = rows.filter((r) => r.isTrial);
  if (q.expired === '1') rows = rows.filter((r) => r.subscriptionStatus === 'EXPIRED' || r.subscriptionStatus === 'NONE');
  const within = Number(q.expiresWithin);
  if (within) rows = rows.filter((r) => r.expiresAt && +r.expiresAt > now && +r.expiresAt <= now + within * DAY_MS);
  rows.sort((a, b) => (a.expiresAt ? +a.expiresAt : Infinity) - (b.expiresAt ? +b.expiresAt : Infinity));
  res.json(paginate(rows, q));
});

// ---------- trial policy (single DB-backed config, same table the resolver reads) ----------

router.get('/trial-policy', async (_req: AuthRequest, res: Response) => res.json(await getTrialPolicy()));

router.put('/trial-policy', async (req: AuthRequest, res: Response) => {
  try {
    const b = req.body || {}; const data: Record<string, any> = {};
    if (b.trialEnabled != null) data.trialEnabled = Boolean(b.trialEnabled);
    if (b.trialDays != null) { const n = intOrNull(b.trialDays, 1); if (n == null) throw new BadInput('Số ngày không hợp lệ.'); data.trialDays = n; }
    if (b.trialMaxPages != null) data.trialMaxPages = intOrNull(b.trialMaxPages);
    if (b.trialMaxMembers != null) data.trialMaxMembers = intOrNull(b.trialMaxMembers);
    await prisma.trialPolicy.upsert({
      where: { id: 'trial_policy_singleton' }, update: data,
      create: { id: 'trial_policy_singleton', ...data },
    });
    await adminLog(req, null, 'admin.trial_policy', `Cấu hình dùng thử: ${JSON.stringify(data)}`);
    res.json(await getTrialPolicy());
  } catch (e) { return bad(res, e); }
});

// ---------- users ----------

router.get('/users', async (req: AuthRequest, res: Response) => {
  const q = req.query as Record<string, string>;
  const pageSize = [25, 50, 100].includes(Number(q.pageSize)) ? Number(q.pageSize) : 25;
  const page = Math.max(1, Number(q.page) || 1);
  const term = (q.q || '').trim();
  const where = term ? { OR: [{ name: { contains: term, mode: 'insensitive' as const } }, { email: { contains: term, mode: 'insensitive' as const } }] } : {};
  const [total, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize,
      select: { id: true, name: true, email: true, isPlatformAdmin: true, isActive: true, createdAt: true,
        memberships: { select: { role: true, status: true, organization: { select: { id: true, name: true } } } } },
    }),
  ]);
  res.json({ total, page, pageSize, items: users.map((u) => ({
    id: u.id, name: u.name, email: u.email, isPlatformAdmin: u.isPlatformAdmin, isActive: u.isActive, createdAt: u.createdAt,
    memberships: u.memberships.map((m) => ({ organizationId: m.organization.id, organizationName: m.organization.name, role: m.role, status: m.status })),
  })) });
});

router.get('/users/:id', async (req: AuthRequest, res: Response) => {
  const u = await prisma.user.findUnique({
    where: { id: String(req.params.id) },
    select: { id: true, name: true, email: true, isPlatformAdmin: true, isActive: true, createdAt: true,
      memberships: { select: { role: true, status: true, organization: { select: { id: true, name: true } } } } },
  });
  if (!u) return res.status(404).json({ error: 'NOT_FOUND' });
  res.json({ ...u, memberships: u.memberships.map((m) => ({ organizationId: m.organization.id, organizationName: m.organization.name, role: m.role, status: m.status })) });
});

router.put('/users/:id/platform-admin', async (req: AuthRequest, res: Response) => {
  const id = String(req.params.id);
  const value = req.body?.value === true;
  const u = await prisma.user.findUnique({ where: { id }, select: { id: true, email: true, isPlatformAdmin: true } });
  if (!u) return res.status(404).json({ error: 'NOT_FOUND' });
  if (!value && u.isPlatformAdmin) {
    const n = await prisma.user.count({ where: { isPlatformAdmin: true, isActive: true } });
    if (n <= 1) return res.status(400).json({ error: 'LAST_PLATFORM_ADMIN', message: 'Không thể gỡ Platform Admin cuối cùng.' });
  }
  await prisma.user.update({ where: { id }, data: { isPlatformAdmin: value } });
  await adminLog(req, null, 'admin.platform_admin', `Platform Admin ${u.email}: ${value}`);
  res.json({ ok: true, isPlatformAdmin: value });
});

// ---------- pages (never returns access tokens) ----------

router.get('/pages', async (req: AuthRequest, res: Response) => {
  const q = req.query as Record<string, string>;
  const pageSize = [25, 50, 100].includes(Number(q.pageSize)) ? Number(q.pageSize) : 25;
  const page = Math.max(1, Number(q.page) || 1);
  const term = (q.q || '').trim();
  const where: any = {};
  if (term) where.OR = [{ name: { contains: term, mode: 'insensitive' } }, { organization: { name: { contains: term, mode: 'insensitive' } } }];
  if (q.status === 'active') where.isActive = true;
  if (q.status === 'inactive') where.isActive = false;
  const [total, pages] = await Promise.all([
    prisma.page.count({ where }),
    prisma.page.findMany({
      where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize,
      select: { id: true, name: true, platform: true, externalId: true, isActive: true, createdAt: true,
        organization: { select: { id: true, name: true } } },
    }),
  ]);
  res.json({ total, page, pageSize, items: pages.map((p) => ({ id: p.id, name: p.name, platform: p.platform, externalId: p.externalId,
    isActive: p.isActive, createdAt: p.createdAt, organizationId: p.organization.id, organizationName: p.organization.name })) });
});

router.use('/billing', billingAdminRouter);
router.use('/settings', platformSettingsAdminRouter);

export { router as adminRouter };
