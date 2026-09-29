import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { prisma } from '../utils/db';
import { config } from '../config';

const JWT_SECRET = process.env.JWT_SECRET || 'mkttools-dev-secret-change-in-production';
const TOKEN_EXPIRY = '7d';

export interface AuthRequest extends Request {
  userId?: string;
  userRole?: string;
  organizationId?: string;
  organizationRole?: 'OWNER' | 'ADMIN' | 'MANAGER' | 'MEMBER';
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
    const requested = (req.header('x-organization-id') || req.query.orgId || '').toString() || null;
    const memberships = await prisma.organizationMember.findMany({
      where: { userId: req.userId, status: 'ACTIVE' },
      include: { organization: { select: { id: true, status: true } } },
      orderBy: { createdAt: 'asc' },
    });
    const active = memberships.filter((m) => m.organization.status === 'ACTIVE');
    if (active.length === 0) return next();
    let picked = active[0]!;
    if (requested) {
      const found = active.find((m) => m.organizationId === requested);
      if (found) picked = found;
    }
    req.organizationId = picked.organizationId;
    req.organizationRole = picked.role as AuthRequest['organizationRole'];
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
    user: { id: user.id, email: user.email, name: user.name, role: user.role },
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

  // Auto-provision a personal organization + STARTER plan so the user isn't stranded.
  const orgName = String(organizationName || `${name} Organization`).trim();
  const org = await prisma.organization.create({
    data: {
      name: orgName,
      ownerUserId: user.id,
      status: 'ACTIVE',
      members: { create: { userId: user.id, role: 'OWNER', status: 'ACTIVE' } },
    },
  });
  const starter = await prisma.subscriptionPlan.findUnique({ where: { code: 'STARTER_3' } });
  if (starter) {
    await prisma.organizationSubscription.create({
      data: { organizationId: org.id, planId: starter.id, status: 'ACTIVE' },
    });
  }

  const token = jwt.sign({ userId: user.id, role: user.role }, JWT_SECRET, {
    expiresIn: TOKEN_EXPIRY,
  });

  res.json({
    token,
    user: { id: user.id, email: user.email, name: user.name, role: user.role },
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
