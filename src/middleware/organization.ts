import { Response, NextFunction } from 'express';
import { prisma } from '../utils/db';
import { AuthRequest } from './auth';

export interface OrgRequest extends AuthRequest {
  organizationId?: string;
  orgRole?: string;
  orgAccessMode?: string;
  orgMemberId?: string;
  isPlatformAdmin?: boolean;
}

export async function attachOrganization(req: OrgRequest, res: Response, next: NextFunction) {
  const orgId = req.headers['x-organization-id'] as string | undefined;
  if (!orgId) {
    return next();
  }

  if (!req.userId) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const user = await prisma.user.findUnique({
    where: { id: req.userId },
    select: { isPlatformAdmin: true },
  });
  req.isPlatformAdmin = user?.isPlatformAdmin ?? false;

  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { id: true, isActive: true },
  });
  if (!org || !org.isActive) {
    return res.status(404).json({ error: 'Organization not found' });
  }

  const membership = await prisma.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId: orgId, userId: req.userId } },
    select: { id: true, role: true, accessMode: true, isActive: true },
  });

  if (!membership || !membership.isActive) {
    if (req.isPlatformAdmin) {
      req.organizationId = orgId;
      req.orgRole = 'PLATFORM_ADMIN';
      req.orgAccessMode = 'ALL';
      return next();
    }
    return res.status(403).json({ error: 'Not a member of this organization' });
  }

  req.organizationId = orgId;
  req.orgRole = membership.role;
  req.orgAccessMode = membership.accessMode;
  req.orgMemberId = membership.id;
  next();
}

export function requireOrganization(req: OrgRequest, res: Response, next: NextFunction) {
  if (!req.organizationId) {
    return res.status(400).json({ error: 'X-Organization-Id header is required' });
  }
  next();
}

export function requireOrgRole(...roles: string[]) {
  return (req: OrgRequest, res: Response, next: NextFunction) => {
    if (!req.organizationId) {
      return res.status(400).json({ error: 'X-Organization-Id header is required' });
    }
    if (req.orgRole === 'PLATFORM_ADMIN') {
      return next();
    }
    if (!req.orgRole || !roles.includes(req.orgRole)) {
      return res.status(403).json({ error: 'Insufficient organization permissions' });
    }
    next();
  };
}

export async function getAccessiblePageIds(req: OrgRequest): Promise<string[] | null> {
  if (!req.organizationId) return null;

  if (req.orgAccessMode === 'ALL' || req.orgRole === 'PLATFORM_ADMIN') {
    return null;
  }

  if (!req.orgMemberId) return [];

  const pageGrants = await prisma.organizationMemberPage.findMany({
    where: { memberId: req.orgMemberId },
    select: { pageId: true },
  });

  const workspaceGrants = await prisma.organizationMemberWorkspace.findMany({
    where: { memberId: req.orgMemberId },
    select: { workspaceId: true },
  });

  if (workspaceGrants.length > 0) {
    const workspacePages = await prisma.workspacePage.findMany({
      where: { workspaceId: { in: workspaceGrants.map(g => g.workspaceId) } },
      select: { pageId: true },
    });
    const allPageIds = new Set([
      ...pageGrants.map(g => g.pageId),
      ...workspacePages.map(wp => wp.pageId),
    ]);
    return [...allPageIds];
  }

  return pageGrants.map(g => g.pageId);
}

export async function assertResourceBelongsToOrg(
  resourceOrgId: string | null | undefined,
  requestOrgId: string,
): Promise<boolean> {
  return resourceOrgId === requestOrgId;
}

export function addOrgFilter(where: Record<string, unknown>, orgId: string, accessiblePageIds: string[] | null): Record<string, unknown> {
  const filtered: Record<string, unknown> = { ...where, organizationId: orgId };
  if (accessiblePageIds !== null) {
    const pid = where.pageId as string | undefined;
    filtered.pageId = pid
      ? (accessiblePageIds.includes(pid) ? pid : '__none__')
      : { in: accessiblePageIds };
  }
  return filtered;
}

export function maskSecret(value: string): string {
  if (!value || value.length < 8) return '••••••••';
  return value.slice(0, 4) + '••••' + value.slice(-4);
}
