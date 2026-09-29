import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { prisma } from '../../utils/db';

const DEFAULT_SECRET = 'mkttools-dev-secret-change-in-production';
export const JWT_SECRET = process.env.JWT_SECRET || DEFAULT_SECRET;
if (process.env.NODE_ENV === 'production' && JWT_SECRET === DEFAULT_SECRET) {
  throw new Error('JWT_SECRET must be set in production');
}
const SESSION_DAYS = 7;

export function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}
export function randomToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

/** Issue a JWT bound to a server-side session row so logout/reset can revoke it. */
export async function createSession(user: { id: string; role: string }, userAgent?: string): Promise<string> {
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 3600 * 1000);
  const s = await prisma.userSession.create({ data: { userId: user.id, userAgent: userAgent?.slice(0, 200), expiresAt } });
  return jwt.sign({ userId: user.id, role: user.role, sid: s.id }, JWT_SECRET, { expiresIn: `${SESSION_DAYS}d` });
}

export interface SessionPayload { userId: string; role: string; sid: string }

/** Verifies signature AND that the session is not revoked/expired and the user is active. */
export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const p = jwt.verify(token, JWT_SECRET) as Partial<SessionPayload>;
    if (!p.userId || !p.sid) return null;
    const s = await prisma.userSession.findUnique({
      where: { id: p.sid }, select: { userId: true, revokedAt: true, expiresAt: true, user: { select: { isActive: true } } },
    });
    if (!s || s.userId !== p.userId || s.revokedAt || s.expiresAt <= new Date() || !s.user.isActive) return null;
    return { userId: p.userId, role: String(p.role || ''), sid: p.sid };
  } catch { return null; }
}

export async function revokeSession(sid: string) {
  await prisma.userSession.updateMany({ where: { id: sid, revokedAt: null }, data: { revokedAt: new Date() } });
}
export async function revokeUserSessions(userId: string, exceptSid?: string) {
  await prisma.userSession.updateMany({
    where: { userId, revokedAt: null, ...(exceptSid ? { id: { not: exceptSid } } : {}) }, data: { revokedAt: new Date() },
  });
}

/** Single-use, hashed, expiring tokens (email verify / password reset / oauth login code). */
export async function issueAuthToken(userId: string, type: 'EMAIL_VERIFY' | 'PASSWORD_RESET' | 'LOGIN_CODE', ttlMs: number): Promise<string> {
  const raw = randomToken();
  await prisma.authToken.create({ data: { userId, type, tokenHash: hashToken(raw), expiresAt: new Date(Date.now() + ttlMs) } });
  return raw;
}
/** Atomically consumes a token; returns userId or null (unknown/expired/used). */
export async function consumeAuthToken(raw: string, type: 'EMAIL_VERIFY' | 'PASSWORD_RESET' | 'LOGIN_CODE'): Promise<string | null> {
  if (!raw || typeof raw !== 'string') return null;
  const h = hashToken(raw);
  const r = await prisma.authToken.updateMany({ where: { tokenHash: h, type, usedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() } });
  if (r.count !== 1) return null;
  const t = await prisma.authToken.findUnique({ where: { tokenHash: h }, select: { userId: true } });
  return t?.userId ?? null;
}
