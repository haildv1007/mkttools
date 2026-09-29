import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { prisma } from '../../utils/db';
import { authMiddleware, AuthRequest } from '../../middleware/auth';
import { provisionOrganizationForOwner } from '../organization';
import { logger } from '../../utils/logger';
import {
  JWT_SECRET, createSession, revokeSession, revokeUserSessions, issueAuthToken, consumeAuthToken, randomToken,
} from './session';
import { sendVerificationEmail, sendPasswordResetEmail } from './mail';
import { providers } from './providers';
import { getPlatformSettingBool } from '../platform-settings';

const router = Router();
const H = 3600 * 1000;

// ---------- helpers ----------

export const normalizeEmail = (v: unknown) => String(v || '').trim().toLowerCase();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const findUserByEmail = (email: string) => prisma.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } });

function passwordProblem(pw: unknown): string | null {
  const s = String(pw || '');
  if (s.length < 8) return 'Mật khẩu cần ít nhất 8 ký tự.';
  if (s.length > 72) return 'Mật khẩu tối đa 72 ký tự.';
  if (!/[A-Za-z]/.test(s) || !/\d/.test(s)) return 'Mật khẩu cần có cả chữ và số.';
  return null;
}
const err = (res: Response, status: number, error: string, message: string) => res.status(status).json({ error, message });

/** Only known internal paths may be used as post-login destinations (no open redirect). */
export function safeNext(n: unknown): string | null {
  const s = String(n || '');
  return /^\/(join\/[A-Za-z0-9_-]{10,200}|onboarding|admin(\/[a-z-]+)?)?$/.test(s) ? s : null;
}

const limitMax = Number(process.env.AUTH_RATE_LIMIT_MAX) || 0;
const limiter = (max: number) => rateLimit({
  windowMs: 15 * 60 * 1000, max: limitMax || max, standardHeaders: true, legacyHeaders: false,
  message: { error: 'RATE_LIMITED', message: 'Bạn thử quá nhiều lần. Vui lòng thử lại sau ít phút.' },
});
const loginLimit = limiter(20), registerLimit = limiter(10), mailLimit = limiter(5);

const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', 10);

function publicUser(u: any) {
  return { id: u.id, name: u.name, email: u.email, role: u.role, isPlatformAdmin: u.isPlatformAdmin === true,
    emailVerified: !!u.emailVerifiedAt, hasPassword: !!u.passwordHash };
}

/** Central onboarding resolver: one place decides where a signed-in user belongs. */
export async function resolveOnboarding(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, onboardingCompletedAt: true } });
  const [memberships, owned, pending] = await Promise.all([
    prisma.organizationMember.count({ where: { userId, status: 'ACTIVE' } }),
    prisma.organization.count({ where: { ownerUserId: userId } }),
    prisma.organizationInvitation.count({
      where: { email: { equals: user?.email || '', mode: 'insensitive' }, status: 'PENDING', expiresAt: { gt: new Date() } },
    }),
  ]);
  let state: 'NEEDS_ORGANIZATION' | 'ONBOARDING_INCOMPLETE' | 'READY' = 'READY';
  if (memberships === 0) state = 'NEEDS_ORGANIZATION';
  else if (!user?.onboardingCompletedAt && owned > 0) state = 'ONBOARDING_INCOMPLETE';
  return { state, pendingInvitations: pending };
}

async function sessionBody(userId: string, token?: string) {
  const u = await prisma.user.findUnique({ where: { id: userId }, include: { authIdentities: { select: { provider: true } } } });
  const memberships = await prisma.organizationMember.findMany({
    where: { userId, status: 'ACTIVE' }, include: { organization: { select: { id: true, name: true, slug: true, status: true, ownerUserId: true } } },
    orderBy: { createdAt: 'asc' },
  });
  return {
    ...(token ? { token } : {}),
    user: { ...publicUser(u), identities: u!.authIdentities.map((i) => i.provider), createdAt: u!.createdAt },
    organizations: memberships.map((m) => ({ id: m.organization.id, name: m.organization.name, slug: m.organization.slug,
      role: m.role, status: m.organization.status, isOwner: m.organization.ownerUserId === userId })),
    onboarding: await resolveOnboarding(userId),
  };
}

async function sendVerification(user: { id: string; email: string; name: string }) {
  await prisma.authToken.updateMany({ where: { userId: user.id, type: 'EMAIL_VERIFY', usedAt: null }, data: { usedAt: new Date() } });
  const raw = await issueAuthToken(user.id, 'EMAIL_VERIFY', 24 * H);
  return sendVerificationEmail(user.email, user.name, raw);
}

// ---------- email + password ----------

router.post('/register', registerLimit, async (req: Request, res: Response) => {
  if (!getPlatformSettingBool('auth.emailPasswordEnabled')) {
    return err(res, 403, 'PASSWORD_LOGIN_DISABLED', 'Đăng ký bằng email/mật khẩu hiện đang tắt.');
  }
  if (!getPlatformSettingBool('general.allowRegistrations')) {
    return err(res, 403, 'REGISTRATION_DISABLED', 'Hệ thống hiện không nhận đăng ký mới.');
  }
  const name = String(req.body?.name || '').trim();
  const email = normalizeEmail(req.body?.email);
  if (!name || name.length > 100) return err(res, 400, 'INVALID_NAME', 'Vui lòng nhập họ tên.');
  if (!EMAIL_RE.test(email)) return err(res, 400, 'INVALID_EMAIL', 'Email không hợp lệ.');
  const pwProblem = passwordProblem(req.body?.password);
  if (pwProblem) return err(res, 400, 'WEAK_PASSWORD', pwProblem);
  if (req.body?.acceptTerms !== true) return err(res, 400, 'TERMS_REQUIRED', 'Bạn cần đồng ý Điều khoản / Chính sách.');
  if (await findUserByEmail(email)) return err(res, 409, 'EMAIL_TAKEN', 'Không thể tạo tài khoản với email này. Hãy đăng nhập hoặc đặt lại mật khẩu.');
  let user;
  try {
    user = await prisma.user.create({
      data: { email, name, role: 'ADMIN', passwordHash: await bcrypt.hash(String(req.body.password), 12), termsAcceptedAt: new Date() },
    });
  } catch (e: any) {
    if (e?.code === 'P2002') return err(res, 409, 'EMAIL_TAKEN', 'Không thể tạo tài khoản với email này. Hãy đăng nhập hoặc đặt lại mật khẩu.');
    throw e;
  }
  const mailed = await sendVerification(user);
  const token = await createSession(user, req.headers['user-agent']);
  res.json({ ...(await sessionBody(user.id, token)), verificationEmailSent: mailed });
});

router.post('/login', loginLimit, async (req: Request, res: Response) => {
  if (!getPlatformSettingBool('auth.emailPasswordEnabled')) {
    return err(res, 403, 'PASSWORD_LOGIN_DISABLED', 'Đăng nhập bằng email/mật khẩu hiện đang tắt.');
  }
  const email = normalizeEmail(req.body?.email);
  const password = String(req.body?.password || '');
  if (!email || !password) return err(res, 400, 'INVALID_INPUT', 'Vui lòng nhập email và mật khẩu.');
  const user = await findUserByEmail(email);
  const ok = await bcrypt.compare(password, user?.passwordHash || DUMMY_HASH);
  if (!user || !user.passwordHash || !ok || !user.isActive) {
    return err(res, 401, 'INVALID_CREDENTIALS', 'Tài khoản hoặc mật khẩu không chính xác.');
  }
  if (getPlatformSettingBool('auth.emailVerificationRequired') && !user.emailVerifiedAt) {
    return err(res, 403, 'EMAIL_NOT_VERIFIED', 'Vui lòng xác minh email trước khi đăng nhập.');
  }
  const token = await createSession(user, req.headers['user-agent']);
  res.json(await sessionBody(user.id, token));
});

router.post('/logout', authMiddleware, async (req: AuthRequest, res: Response) => {
  if (req.sessionId) await revokeSession(req.sessionId);
  res.json({ success: true });
});

router.get('/session', authMiddleware, async (req: AuthRequest, res: Response) => {
  res.json(await sessionBody(req.userId!));
});

// Kept for existing callers.
router.get('/me', authMiddleware, async (req: AuthRequest, res: Response) => {
  const body = await sessionBody(req.userId!);
  res.json({ ...body.user, organizations: body.organizations });
});

router.get('/providers', (_req, res) => {
  res.json(Object.fromEntries(Object.values(providers).map((p) => [p.id.toLowerCase(), p.enabled()])));
});

// ---------- email verification ----------

router.post('/verify-email', async (req: Request, res: Response) => {
  const userId = await consumeAuthToken(String(req.body?.token || ''), 'EMAIL_VERIFY');
  if (!userId) return err(res, 400, 'INVALID_TOKEN', 'Liên kết xác minh không hợp lệ hoặc đã hết hạn.');
  await prisma.user.updateMany({ where: { id: userId, emailVerifiedAt: null }, data: { emailVerifiedAt: new Date() } });
  res.json({ success: true });
});

router.post('/resend-verification', mailLimit, authMiddleware, async (req: AuthRequest, res: Response) => {
  const u = await prisma.user.findUnique({ where: { id: req.userId } });
  if (u && !u.emailVerifiedAt) await sendVerification(u);
  res.json({ success: true });
});

// ---------- password reset ----------

router.post('/forgot-password', mailLimit, async (req: Request, res: Response) => {
  const email = normalizeEmail(req.body?.email);
  const user = EMAIL_RE.test(email) ? await findUserByEmail(email) : null;
  if (user && user.isActive) {
    await prisma.authToken.updateMany({ where: { userId: user.id, type: 'PASSWORD_RESET', usedAt: null }, data: { usedAt: new Date() } });
    await sendPasswordResetEmail(user.email, await issueAuthToken(user.id, 'PASSWORD_RESET', H));
  }
  res.json({ success: true, message: 'Nếu email tồn tại, chúng tôi đã gửi hướng dẫn đặt lại mật khẩu.' });
});

router.post('/reset-password', mailLimit, async (req: Request, res: Response) => {
  const problem = passwordProblem(req.body?.password);
  if (problem) return err(res, 400, 'WEAK_PASSWORD', problem);
  const userId = await consumeAuthToken(String(req.body?.token || ''), 'PASSWORD_RESET');
  if (!userId) return err(res, 400, 'INVALID_TOKEN', 'Liên kết đặt lại mật khẩu đã hết hạn hoặc đã được sử dụng.');
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: await bcrypt.hash(String(req.body.password), 12), emailVerifiedAt: undefined },
  });
  await prisma.user.updateMany({ where: { id: userId, emailVerifiedAt: null }, data: { emailVerifiedAt: new Date() } }); // reset link proves mailbox ownership
  await revokeUserSessions(userId);
  res.json({ success: true });
});

// ---------- account ----------

router.put('/profile', authMiddleware, async (req: AuthRequest, res: Response) => {
  const name = String(req.body?.name || '').trim();
  if (!name || name.length > 100) return err(res, 400, 'INVALID_NAME', 'Họ tên không hợp lệ.');
  await prisma.user.update({ where: { id: req.userId }, data: { name } });
  res.json(await sessionBody(req.userId!));
});

router.put('/password', authMiddleware, async (req: AuthRequest, res: Response) => {
  const u = await prisma.user.findUnique({ where: { id: req.userId } });
  if (!u) return err(res, 401, 'UNAUTHORIZED', 'Phiên đăng nhập không hợp lệ.');
  const problem = passwordProblem(req.body?.newPassword);
  if (problem) return err(res, 400, 'WEAK_PASSWORD', problem);
  if (u.passwordHash && !(await bcrypt.compare(String(req.body?.currentPassword || ''), u.passwordHash))) {
    return err(res, 400, 'WRONG_PASSWORD', 'Mật khẩu hiện tại không chính xác.');
  }
  if (!u.passwordHash && !u.emailVerifiedAt) return err(res, 403, 'EMAIL_NOT_VERIFIED', 'Vui lòng xác minh email trước.');
  await prisma.user.update({ where: { id: u.id }, data: { passwordHash: await bcrypt.hash(String(req.body.newPassword), 12) } });
  await revokeUserSessions(u.id, req.sessionId);
  res.json({ success: true });
});

// ---------- onboarding ----------

router.post('/onboarding/organization', authMiddleware, async (req: AuthRequest, res: Response) => {
  const name = String(req.body?.name || '').trim();
  if (name.length < 2 || name.length > 100) return err(res, 400, 'INVALID_NAME', 'Tên không gian làm việc cần 2–100 ký tự.');
  const { org, trial } = await provisionOrganizationForOwner(req.userId!, name);
  res.json({ organization: { id: org.id, name: org.name }, trial, onboarding: await resolveOnboarding(req.userId!) });
});

router.post('/onboarding/complete', authMiddleware, async (req: AuthRequest, res: Response) => {
  await prisma.user.update({ where: { id: req.userId }, data: { onboardingCompletedAt: new Date() } });
  res.json({ onboarding: await resolveOnboarding(req.userId!) });
});

// ---------- OAuth (provider-aware; Google only for now) ----------

const OAUTH_COOKIE = 'mkt_oauth';
const cookieOpts = { httpOnly: true, sameSite: 'lax' as const, secure: process.env.NODE_ENV === 'production', path: '/api/auth', maxAge: 10 * 60 * 1000 };
function readCookie(req: Request, name: string): string | null {
  const m = (req.headers.cookie || '').split(';').map((c) => c.trim()).find((c) => c.startsWith(name + '='));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : null;
}
const b64u = (b: Buffer) => b.toString('base64url');

router.get('/google/start', (req: Request, res: Response) => {
  const p = providers.google;
  if (!p?.enabled()) return res.redirect('/login?error=provider_unavailable');
  const state = randomToken(), nonce = randomToken(), verifier = randomToken();
  const challenge = b64u(crypto.createHash('sha256').update(verifier).digest());
  const signed = jwt.sign({ state, nonce, verifier, next: safeNext(req.query.next) }, JWT_SECRET, { expiresIn: '10m' });
  res.cookie(OAUTH_COOKIE, signed, cookieOpts);
  res.redirect(p.authUrl({ state, nonce, challenge }));
});

router.get('/google/callback', async (req: Request, res: Response) => {
  const p = providers.google;
  const fail = (code: string) => { res.clearCookie(OAUTH_COOKIE, { path: '/api/auth' }); return res.redirect('/login?error=' + code); };
  try {
    const raw = readCookie(req, OAUTH_COOKIE);
    if (!p?.enabled() || !raw || req.query.error || !req.query.code) return fail('google_failed');
    const c = jwt.verify(raw, JWT_SECRET) as { state: string; nonce: string; verifier: string; next: string | null };
    const given = Buffer.from(String(req.query.state || '')), want = Buffer.from(c.state);
    if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) return fail('google_failed'); // CSRF
    const ident = await p.exchange({ code: String(req.query.code), verifier: c.verifier, nonce: c.nonce });
    if (!ident.emailVerified) return fail('google_unverified');
    const email = normalizeEmail(ident.email);

    let user = (await prisma.userAuthIdentity.findUnique({
      where: { provider_providerUserId: { provider: p.id, providerUserId: ident.providerUserId } }, include: { user: true },
    }))?.user ?? null;
    if (!user) {
      user = await findUserByEmail(email);
      if (user) {
        // Link to the SAME account. If that account was never email-verified, whoever pre-registered it may know
        // its password: drop the password and sessions so only the verified Google owner controls it.
        if (!user.emailVerifiedAt && user.passwordHash) {
          await prisma.user.update({ where: { id: user.id }, data: { passwordHash: null } });
          await revokeUserSessions(user.id);
        }
      } else {
        try {
          user = await prisma.user.create({ data: { email, name: ident.name.slice(0, 100), role: 'ADMIN', termsAcceptedAt: new Date() } });
        } catch (e: any) { if (e?.code === 'P2002') user = await findUserByEmail(email); else throw e; }
      }
      if (!user) return fail('google_failed');
      await prisma.userAuthIdentity.upsert({
        where: { provider_providerUserId: { provider: p.id, providerUserId: ident.providerUserId } },
        update: {}, create: { userId: user.id, provider: p.id, providerUserId: ident.providerUserId, providerEmail: email },
      });
    }
    if (!user.isActive) return fail('account_disabled');
    if (!user.emailVerifiedAt) await prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });
    res.clearCookie(OAUTH_COOKIE, { path: '/api/auth' });
    const code = await issueAuthToken(user.id, 'LOGIN_CODE', 60 * 1000);
    res.redirect(`/auth/callback?code=${code}${c.next ? '&next=' + encodeURIComponent(c.next) : ''}`);
  } catch (e) {
    logger.warn({ err: e instanceof Error ? e.message : 'unknown' }, 'OAuth callback failed');
    return fail('google_failed');
  }
});

// One-time login code -> session token (keeps tokens out of URLs/history/logs).
router.post('/exchange', loginLimit, async (req: Request, res: Response) => {
  const userId = await consumeAuthToken(String(req.body?.code || ''), 'LOGIN_CODE');
  if (!userId) return err(res, 400, 'INVALID_CODE', 'Phiên đăng nhập đã hết hạn. Vui lòng thử lại.');
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user?.isActive) return err(res, 403, 'ACCOUNT_DISABLED', 'Tài khoản đã bị vô hiệu hóa.');
  res.json(await sessionBody(user.id, await createSession(user, req.headers['user-agent'])));
});

export { router as authRouter };
