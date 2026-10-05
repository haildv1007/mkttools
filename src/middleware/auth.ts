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
    where: { userId: user.id, isActive: true },
    include: {
      organization: { select: { id: true, name: true, slug: true, isActive: true } },
    },
  });

  res.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      isPlatformAdmin: user.isPlatformAdmin,
    },
    organizations: memberships
      .filter(m => m.organization.isActive)
      .map(m => ({
        id: m.organization.id,
        name: m.organization.name,
        slug: m.organization.slug,
        role: m.role,
        accessMode: m.accessMode,
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

  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: { email, passwordHash, name, role: 'ADMIN' },
    });

    const orgName = organizationName || `${name}'s Organization`;
    const slug = orgName
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/đ/g, 'd')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 80) || 'org';

    let finalSlug = slug;
    let suffix = 0;
    while (true) {
      const candidate = suffix === 0 ? finalSlug : `${slug}-${suffix}`;
      const exists = await tx.organization.findUnique({ where: { slug: candidate } });
      if (!exists) {
        finalSlug = candidate;
        break;
      }
      suffix++;
    }

    const org = await tx.organization.create({
      data: { name: orgName, slug: finalSlug },
    });

    await tx.organizationMember.create({
      data: {
        organizationId: org.id,
        userId: user.id,
        role: 'OWNER',
        accessMode: 'ALL',
      },
    });

    return { user, org };
  });

  const token = jwt.sign({ userId: result.user.id, role: result.user.role }, JWT_SECRET, {
    expiresIn: TOKEN_EXPIRY,
  });

  res.json({
    token,
    user: {
      id: result.user.id,
      email: result.user.email,
      name: result.user.name,
      role: result.user.role,
      isPlatformAdmin: result.user.isPlatformAdmin,
    },
    organizations: [{
      id: result.org.id,
      name: result.org.name,
      slug: result.org.slug,
      role: 'OWNER',
      accessMode: 'ALL',
    }],
  });
});

authRouter.get('/me', authMiddleware, async (req: AuthRequest, res: Response) => {
  const user = await prisma.user.findUnique({
    where: { id: req.userId },
    select: {
      id: true, email: true, name: true, role: true,
      isPlatformAdmin: true, telegramChatId: true, createdAt: true,
    },
  });
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  const memberships = await prisma.organizationMember.findMany({
    where: { userId: req.userId, isActive: true },
    include: {
      organization: { select: { id: true, name: true, slug: true, isActive: true } },
    },
  });

  res.json({
    ...user,
    organizations: memberships
      .filter(m => m.organization.isActive)
      .map(m => ({
        id: m.organization.id,
        name: m.organization.name,
        slug: m.organization.slug,
        role: m.role,
        accessMode: m.accessMode,
      })),
  });
});

export { authRouter };
