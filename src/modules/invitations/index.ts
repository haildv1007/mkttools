import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { prisma } from '../../utils/db';
import { AuthRequest, authMiddleware } from '../../middleware/auth';
import { roleAtLeast, OrgRole, OrganizationQuota, resolveSubscriptionContext } from '../organization';

const TOKEN_LEN = 32;
const DEFAULT_TTL_DAYS = 14;

function generateToken(): { raw: string; hash: string } {
  const raw = crypto.randomBytes(TOKEN_LEN).toString('base64url');
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  return { raw, hash };
}

function normalizeEmail(v: unknown): string {
  return String(v || '').trim().toLowerCase();
}

function requireAdmin(req: AuthRequest, res: Response): boolean {
  if (!roleAtLeast(req.organizationRole, 'ADMIN')) {
    res.status(403).json({ error: 'FORBIDDEN', message: 'Chỉ Owner/Admin được mời thành viên.' });
    return false;
  }
  return true;
}

const orgRouter = Router();

// List pending invitations for the organization.
orgRouter.get('/', async (req: AuthRequest, res: Response) => {
  if (!requireAdmin(req, res)) return;
  const rows = await prisma.organizationInvitation.findMany({
    where: { organizationId: req.organizationId, status: 'PENDING' },
    orderBy: { createdAt: 'desc' },
  });
  res.json(rows.map((r) => ({
    id: r.id, email: r.email, role: r.role, accessMode: r.accessMode,
    status: r.status, expiresAt: r.expiresAt, createdAt: r.createdAt,
  })));
});

// Create an invitation. Returns the raw token exactly once so the caller can copy the link.
orgRouter.post('/', async (req: AuthRequest, res: Response) => {
  if (!requireAdmin(req, res)) return;
  const email = normalizeEmail(req.body?.email);
  if (!email || !email.includes('@')) return res.status(400).json({ error: 'INVALID_EMAIL' });

  // Block if subscription expired
  const subCtx = await resolveSubscriptionContext(req.organizationId!);
  if (subCtx.status === 'EXPIRED' || subCtx.status === 'NONE') {
    return res.status(402).json({ error: 'SUBSCRIPTION_EXPIRED', message: 'Thời gian dùng thử đã kết thúc. Vui lòng nâng cấp gói để tiếp tục sử dụng.' });
  }

  const role = ['ADMIN', 'MANAGER', 'MEMBER'].includes(req.body?.role) ? req.body.role : 'MEMBER';
  const accessMode = req.body?.accessMode === 'RESTRICTED' ? 'RESTRICTED' : 'ALL';
  if ((role === 'ADMIN') && accessMode === 'RESTRICTED') {
    return res.status(400).json({ error: 'CANNOT_RESTRICT_ADMIN' });
  }

  // Existing member (by user email)?
  const existingUser = await prisma.user.findUnique({ where: { email } });
  if (existingUser) {
    const existingMember = await prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId: req.organizationId!, userId: existingUser.id } },
    });
    if (existingMember && existingMember.status === 'ACTIVE') {
      return res.status(409).json({ error: 'ALREADY_MEMBER' });
    }
  }

  const activeInvite = await prisma.organizationInvitation.findFirst({
    where: { organizationId: req.organizationId, email, status: 'PENDING' },
  });
  if (activeInvite) return res.status(409).json({ error: 'ALREADY_INVITED', message: 'Đã có lời mời đang chờ cho email này.' });

  // Quota check at invite creation - re-checked at acceptance too.
  const memberCheck = await OrganizationQuota.canAddMember(req.organizationId!);
  if (!memberCheck.ok) {
    return res.status(422).json({ error: 'MEMBER_LIMIT_REACHED', message: 'Bạn đã sử dụng hết số thành viên của gói hiện tại.' });
  }

  const { raw, hash } = generateToken();
  const expiresAt = new Date(Date.now() + DEFAULT_TTL_DAYS * 24 * 3600 * 1000);
  const row = await prisma.organizationInvitation.create({
    data: {
      organizationId: req.organizationId!,
      email, role, accessMode,
      invitedByUserId: req.userId!,
      tokenHash: hash,
      expiresAt,
    },
  });

  // Return the raw token exactly once - never persisted, never emitted again.
  const link = `/join/${raw}`;
  res.json({
    id: row.id, email: row.email, role: row.role, accessMode: row.accessMode,
    expiresAt: row.expiresAt, status: row.status,
    inviteToken: raw, inviteUrl: link,
  });
});

// Cancel a pending invitation.
orgRouter.delete('/:id', async (req: AuthRequest, res: Response) => {
  if (!requireAdmin(req, res)) return;
  const id = String(req.params.id);
  const inv = await prisma.organizationInvitation.findUnique({ where: { id } });
  if (!inv || inv.organizationId !== req.organizationId) return res.status(404).json({ error: 'NOT_FOUND' });
  if (inv.status !== 'PENDING') return res.status(400).json({ error: 'NOT_PENDING' });
  await prisma.organizationInvitation.update({ where: { id }, data: { status: 'CANCELLED' } });
  res.json({ success: true });
});

// Public (unauthenticated) preview: given a token, tell the client what
// organization it invites into, so login/register flows can display context.
const publicRouter = Router();

async function findInvitationByToken(token: string) {
  if (!token || typeof token !== 'string') return null;
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  return prisma.organizationInvitation.findUnique({ where: { tokenHash: hash } });
}

publicRouter.get('/:token', async (req: Request, res: Response) => {
  const inv = await findInvitationByToken(String(req.params.token));
  if (!inv) return res.status(404).json({ error: 'INVITATION_NOT_FOUND' });
  const now = new Date();
  if (inv.status === 'CANCELLED') return res.status(410).json({ error: 'INVITATION_CANCELLED' });
  if (inv.status === 'ACCEPTED') return res.status(410).json({ error: 'INVITATION_ACCEPTED' });
  if (inv.expiresAt < now) {
    await prisma.organizationInvitation.update({ where: { id: inv.id }, data: { status: 'EXPIRED' } });
    return res.status(410).json({ error: 'INVITATION_EXPIRED' });
  }
  const org = await prisma.organization.findUnique({ where: { id: inv.organizationId }, select: { name: true } });
  res.json({
    email: inv.email,
    role: inv.role,
    accessMode: inv.accessMode,
    organizationName: org?.name,
    expiresAt: inv.expiresAt,
  });
});

// Accept an invitation: creates the OrganizationMember row for the authenticated
// user, transactionally. Idempotent: repeat calls after acceptance succeed.
publicRouter.post('/:token/accept', authMiddleware, async (req: AuthRequest, res: Response) => {
  if (!req.userId) return res.status(401).json({ error: 'Unauthorized' });
  const token = String(req.params.token);
  const inv = await findInvitationByToken(token);
  if (!inv) return res.status(404).json({ error: 'INVITATION_NOT_FOUND' });
  const now = new Date();
  if (inv.status === 'CANCELLED') return res.status(410).json({ error: 'INVITATION_CANCELLED', message: 'Lời mời đã bị huỷ.' });
  if (inv.status === 'EXPIRED' || inv.expiresAt < now) {
    if (inv.status !== 'EXPIRED') {
      await prisma.organizationInvitation.update({ where: { id: inv.id }, data: { status: 'EXPIRED' } });
    }
    return res.status(410).json({ error: 'INVITATION_EXPIRED', message: 'Lời mời đã hết hạn.' });
  }

  const user = await prisma.user.findUnique({ where: { id: req.userId } });
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  // Enforce email match - the invitation is bound to that email.
  if (user.email.toLowerCase() !== inv.email.toLowerCase()) {
    return res.status(403).json({ error: 'INVITATION_EMAIL_MISMATCH', message: 'Email của tài khoản không khớp với lời mời.' });
  }
  if (!user.emailVerifiedAt) {
    return res.status(403).json({ error: 'EMAIL_NOT_VERIFIED', message: 'Vui lòng xác minh email trước khi chấp nhận lời mời.' });
  }

  if (inv.status === 'ACCEPTED') {
    // Idempotent: already accepted. Ensure membership actually exists.
    const existing = await prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId: inv.organizationId, userId: user.id } },
    });
    if (existing) return res.json({ success: true, organizationId: inv.organizationId, alreadyAccepted: true });
  }

  // Re-check quota at accept time. Already-ACTIVE members are idempotent; skip quota for them.
  const existingAtAccept = await prisma.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId: inv.organizationId, userId: user.id } },
  });
  if (!existingAtAccept || existingAtAccept.status !== 'ACTIVE') {
    const memberCheck = await OrganizationQuota.canAddMember(inv.organizationId);
    if (!memberCheck.ok) {
      return res.status(422).json({ error: 'MEMBER_LIMIT_REACHED', message: 'Bạn đã sử dụng hết số thành viên của gói hiện tại.' });
    }
  }

  await prisma.$transaction(async (tx) => {
    const existing = await tx.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId: inv.organizationId, userId: user.id } },
    });
    if (existing && existing.status === 'ACTIVE') {
      // Already an active member - just mark accepted.
      await tx.organizationInvitation.update({
        where: { id: inv.id }, data: { status: 'ACCEPTED', acceptedAt: now },
      });
      return;
    }
    if (existing) {
      await tx.organizationMember.update({
        where: { id: existing.id },
        data: { status: 'ACTIVE', role: inv.role, accessMode: inv.accessMode },
      });
    } else {
      await tx.organizationMember.create({
        data: {
          organizationId: inv.organizationId, userId: user.id,
          role: inv.role, status: 'ACTIVE', accessMode: inv.accessMode,
        },
      });
    }
    await tx.organizationInvitation.update({
      where: { id: inv.id }, data: { status: 'ACCEPTED', acceptedAt: now },
    });
  });

  await prisma.user.updateMany({ where: { id: user.id, onboardingCompletedAt: null }, data: { onboardingCompletedAt: new Date() } });
  res.json({ success: true, organizationId: inv.organizationId });
});

export { orgRouter as organizationInvitationRouter, publicRouter as publicInvitationRouter };
