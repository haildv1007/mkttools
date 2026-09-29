import { prisma } from '../../utils/db';
import type { OrgRole } from '../organization';

export interface AccessContext {
  organizationId: string;
  userId: string;
  role: OrgRole;
  accessMode: 'ALL' | 'RESTRICTED';
  memberId: string | null;
  isAllAccess: boolean;
}

/**
 * Resolve the current member's access context (role + mode + memberId).
 * ALL-mode when role is OWNER/ADMIN or accessMode=ALL.
 */
export async function getAccessContext(organizationId: string, userId: string): Promise<AccessContext | null> {
  const m = await prisma.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId, userId } },
    select: { id: true, role: true, accessMode: true, status: true },
  });
  if (!m || m.status !== 'ACTIVE') return null;
  const role = m.role as OrgRole;
  const accessMode = m.accessMode as 'ALL' | 'RESTRICTED';
  // OWNER/ADMIN are always effectively ALL, regardless of accessMode column.
  const isAllAccess = role === 'OWNER' || role === 'ADMIN' || accessMode === 'ALL';
  return { organizationId, userId, role, accessMode, memberId: m.id, isAllAccess };
}

/** All active pages the user may access within the organization. */
export async function getAccessiblePageIds(ctx: AccessContext): Promise<string[]> {
  if (ctx.isAllAccess) {
    const pages = await prisma.page.findMany({
      where: { organizationId: ctx.organizationId, isActive: true },
      select: { id: true },
    });
    return pages.map((p) => p.id);
  }
  if (!ctx.memberId) return [];
  // Union: direct page grants + pages inside assigned workspaces.
  const [direct, viaWs] = await Promise.all([
    prisma.organizationMemberPage.findMany({
      where: { organizationMemberId: ctx.memberId, page: { isActive: true, organizationId: ctx.organizationId } },
      select: { pageId: true },
    }),
    prisma.workspacePage.findMany({
      where: {
        page: { isActive: true, organizationId: ctx.organizationId },
        workspace: { memberGrants: { some: { organizationMemberId: ctx.memberId } } },
      },
      select: { pageId: true },
    }),
  ]);
  const set = new Set<string>();
  for (const r of direct) set.add(r.pageId);
  for (const r of viaWs) set.add(r.pageId);
  return [...set];
}

/**
 * Workspaces the user may see. RESTRICTED members only see workspaces
 * they are directly assigned to (never a workspace merely because they
 * happen to have direct access to one of its pages).
 */
export async function getAccessibleWorkspaceIds(ctx: AccessContext): Promise<string[]> {
  if (ctx.isAllAccess) {
    const ws = await prisma.workspace.findMany({
      where: { organizationId: ctx.organizationId },
      select: { id: true },
    });
    return ws.map((w) => w.id);
  }
  if (!ctx.memberId) return [];
  const grants = await prisma.organizationMemberWorkspace.findMany({
    where: { organizationMemberId: ctx.memberId },
    select: { workspaceId: true },
  });
  return grants.map((g) => g.workspaceId);
}

export async function canAccessPage(ctx: AccessContext, pageId: string): Promise<boolean> {
  if (ctx.isAllAccess) {
    const p = await prisma.page.findUnique({ where: { id: pageId }, select: { organizationId: true } });
    return !!p && p.organizationId === ctx.organizationId;
  }
  const ids = await getAccessiblePageIds(ctx);
  return ids.includes(pageId);
}

export async function canAccessWorkspace(ctx: AccessContext, workspaceId: string): Promise<boolean> {
  if (ctx.isAllAccess) {
    const w = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { organizationId: true } });
    return !!w && w.organizationId === ctx.organizationId;
  }
  const ids = await getAccessibleWorkspaceIds(ctx);
  return ids.includes(workspaceId);
}

export class AccessDeniedError extends Error {
  status = 403 as const;
  code = 'RESOURCE_ACCESS_DENIED' as const;
  constructor(message = 'Bạn không có quyền truy cập tài nguyên này.') { super(message); }
}

export async function assertPageAccess(ctx: AccessContext, pageId: string): Promise<void> {
  if (!(await canAccessPage(ctx, pageId))) throw new AccessDeniedError();
}
export async function assertWorkspaceAccess(ctx: AccessContext, workspaceId: string): Promise<void> {
  if (!(await canAccessWorkspace(ctx, workspaceId))) throw new AccessDeniedError();
}

/** Intersect a caller-requested id list with the accessible set. Empty => empty. */
export async function intersectPageIds(ctx: AccessContext, requested: string[]): Promise<string[]> {
  if (!requested.length) return [];
  const allowed = new Set(await getAccessiblePageIds(ctx));
  return requested.filter((id) => allowed.has(id));
}
