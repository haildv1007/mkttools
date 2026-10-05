import { Request, Response, NextFunction } from 'express';
import { prisma } from '../utils/db';
import { resolveCurrentOrganization, readRequestedOrgId, sendOrgDenied } from '../modules/organization';

import { verifySessionToken } from '../modules/auth/session';

export interface AuthRequest extends Request {
  userId?: string;
  userRole?: string;
  sessionId?: string;
  organizationId?: string;
  organizationRole?: 'OWNER' | 'ADMIN' | 'MANAGER' | 'MEMBER';
  organizationMemberId?: string;
  accessMode?: 'ALL' | 'RESTRICTED';
  isAllAccess?: boolean;
}

export async function authMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid authorization header' });
  }
  const p = await verifySessionToken(header.slice(7));
  if (!p) return res.status(401).json({ error: 'Invalid or expired token' });
  req.userId = p.userId;
  req.userRole = p.role;
  req.sessionId = p.sid;
  next();
}

/**
 * Attach current organization context after authMiddleware.
 * Reads header X-Organization-Id (or ?orgId), validates membership,
 * falls back to the user's first active membership. If the user has no
 * membership at all, req.organizationId stays undefined - routes that
 * strictly require an org should still check.
 */
export async function attachOrganization(req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.userId) return next();
  try {
    const { current, denied } = await resolveCurrentOrganization(req.userId, readRequestedOrgId(req));
    if (denied) return sendOrgDenied(res);
    if (!current) return next();
    req.organizationId = current.organizationId;
    req.organizationRole = current.role as AuthRequest['organizationRole'];
    // Suspended org: read-only. One central guard instead of per-route checks.
    if (current.organization.status === 'SUSPENDED' && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      return res.status(403).json({ error: 'ORGANIZATION_SUSPENDED', message: 'Tổ chức đang bị tạm ngưng. Vui lòng liên hệ hỗ trợ.' });
    }
    // Include access mode + memberId so downstream can decide RESTRICTED vs ALL.
    const m = await prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId: current.organizationId, userId: req.userId } },
      select: { id: true, accessMode: true },
    });
    req.organizationMemberId = m?.id;
    req.accessMode = (m?.accessMode as 'ALL' | 'RESTRICTED') ?? 'ALL';
    req.isAllAccess = req.organizationRole === 'OWNER' || req.organizationRole === 'ADMIN' || req.accessMode === 'ALL';
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Strict version: 403 when no org resolved.
 */
export function requireOrganization(req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.organizationId) {
    return res.status(403).json({ error: 'NO_ORGANIZATION', message: 'Bạn chưa thuộc tổ chức nào.' });
  }
  next();
}

export function requireRole(...roles: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.userRole || !roles.includes(req.userRole)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}


