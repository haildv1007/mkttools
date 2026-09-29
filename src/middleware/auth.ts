import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { prisma } from '../utils/db';
import { config } from '../config';
import { resolveCurrentOrganization, readRequestedOrgId, sendOrgDenied } from '../modules/organization';

const JWT_SECRET = process.env.JWT_SECRET || 'mkttools-dev-secret-change-in-production';
const TOKEN_EXPIRY = '7d';

export interface AuthRequest extends Request {
  userId?: string;
  userRole?: string;
  organizationId?: string;
  organizationRole?: 'OWNER' | 'ADMIN' | 'MANAGER' | 'MEMBER';
  organizationMemberId?: string;
  accessMode?: 'ALL' | 'RESTRICTED';
  isAllAccess?: boolean;
}

export function authMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid authorization header' });
  }

  try {
    const token = header.slice(7);
    const payload = jwt.verify(token, JWT_SECRET) as { userId: string; role: string };
    req.userId = payload.userId;
    req.userRole = payload.role;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/**
 * Attach current organization context after authMiddleware.
 * Reads header X-Organization-Id (or ?orgId), validates membership,
 * falls back to the user's first active membership. If the user has no
 * membership at all, req.organizationId stays undefined — routes that
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

const authRouter = Router();

authRouter.post('/login', async (req: Request, res: Response) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.isActive) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = jwt.sign({ userId: user.id, role: user.role }, JWT_SECRET, {
    expiresIn: TOKEN_EXPIRY,
  });

  const memberships = await prisma.organizationMember.findMany({
    where: { userId: user.id, status: 'ACTIVE' },
    include: { organization: { select: { id: true, name: true, slug: true, status: true } } },
    orderBy: { createdAt: 'asc' },
  });

  res.json({
    token,
    user: { id: user.id, email: user.email, name: user.name, role: user.role, isPlatformAdmin: (user as any).isPlatformAdmin === true },
    organizations: memberships.map((m) => ({
      id: m.organization.id,
      name: m.organization.name,
      slug: m.organization.slug,
      role: m.role,
    })),
  });
});

authRouter.post('/register', async (req: Request, res: Response) => {
  const { email, password, name, organizationName } = req.body;
  if (!email || !password || !name) {
    return res.status(400).json({ error: 'Email, password, and name required' });
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return res.status(409).json({ error: 'Email already registered' });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.create({
    data: { email, passwordHash, name, role: 'ADMIN' },
  });

  // Auto-provision a personal organization. Start a trial if eligible.
  const orgName = String(organizationName || `${name} Organization`).trim();
  const org = await prisma.organization.create({
    data: {
      name: orgName,
      ownerUserId: user.id,
      status: 'ACTIVE',
      members: { create: { userId: user.id, role: 'OWNER', status: 'ACTIVE' } },
    },
  });

  // Trial eligibility: policy must be enabled AND this owner has never consumed a trial.
  const { getTrialPolicy } = await import('../modules/organization');
  const trialPolicy = await getTrialPolicy();
  const existingEntitlement = await prisma.userTrialEntitlement.findUnique({ where: { userId: user.id } });
  const starter = await prisma.subscriptionPlan.findUnique({ where: { code: 'STARTER_3' } });

  if (trialPolicy.trialEnabled && !existingEntitlement && starter) {
    const now = new Date();
    const trialEndsAt = new Date(now.getTime() + trialPolicy.trialDays * 24 * 3600 * 1000);
    await prisma.organizationSubscription.create({
      data: { organizationId: org.id, planId: starter.id, status: 'TRIAL', trialStartedAt: now, trialEndsAt },
    });
    await prisma.userTrialEntitlement.create({
      data: { id: `ute_${user.id}`, userId: user.id, organizationId: org.id, startedAt: now },
    });
  } else if (starter) {
    // Trial not available — assign STARTER ACTIVE (no trial)
    await prisma.organizationSubscription.create({
      data: { organizationId: org.id, planId: starter.id, status: 'ACTIVE' },
    });
  }

  const token = jwt.sign({ userId: user.id, role: user.role }, JWT_SECRET, {
    expiresIn: TOKEN_EXPIRY,
  });

  res.json({
    token,
    user: { id: user.id, email: user.email, name: user.name, role: user.role, isPlatformAdmin: (user as any).isPlatformAdmin === true },
    organization: { id: org.id, name: org.name, role: 'OWNER' },
  });
});

authRouter.get('/me', authMiddleware, async (req: AuthRequest, res: Response) => {
  const user = await prisma.user.findUnique({
    where: { id: req.userId },
    select: { id: true, email: true, name: true, role: true, telegramChatId: true, isPlatformAdmin: true, createdAt: true },
  });
  const memberships = user ? await prisma.organizationMember.findMany({
    where: { userId: user.id, status: 'ACTIVE' },
    include: { organization: { select: { id: true, name: true, slug: true, status: true, ownerUserId: true } } },
    orderBy: { createdAt: 'asc' },
  }) : [];
  res.json({
    ...user,
    organizations: memberships.map((m) => ({
      id: m.organization.id,
      name: m.organization.name,
      slug: m.organization.slug,
      role: m.role,
      status: m.organization.status,
      isOwner: m.organization.ownerUserId === user?.id,
    })),
  });
});

export { authRouter };
