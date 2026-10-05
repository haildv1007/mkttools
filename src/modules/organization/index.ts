import { Router, Response } from 'express';
import { prisma } from '../../utils/db';
import { OrgRequest, requireOrganization, requireOrgRole, attachOrganization, maskSecret } from '../../middleware/organization';

const router = Router();

router.get('/', async (req: OrgRequest, res: Response) => {
  if (!req.userId) return res.status(401).json({ error: 'Authentication required' });
  const memberships = await prisma.organizationMember.findMany({
    where: { userId: req.userId, isActive: true },
    include: {
      organization: { select: { id: true, name: true, slug: true, isActive: true, createdAt: true } },
    },
  });
  res.json(memberships.filter(m => m.organization.isActive).map(m => ({
    id: m.organization.id,
    name: m.organization.name,
    slug: m.organization.slug,
    role: m.role,
    accessMode: m.accessMode,
    createdAt: m.organization.createdAt,
  })));
});

router.post('/', async (req: OrgRequest, res: Response) => {
  if (!req.userId) return res.status(401).json({ error: 'Authentication required' });
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Organization name is required' });

  const slug = name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'org';
  let finalSlug = slug;
  let suffix = 0;
  while (true) {
    const candidate = suffix === 0 ? finalSlug : `${slug}-${suffix}`;
    const exists = await prisma.organization.findUnique({ where: { slug: candidate } });
    if (!exists) { finalSlug = candidate; break; }
    suffix++;
  }

  const result = await prisma.$transaction(async (tx) => {
    const org = await tx.organization.create({ data: { name, slug: finalSlug } });
    await tx.organizationMember.create({
      data: { organizationId: org.id, userId: req.userId!, role: 'OWNER', accessMode: 'ALL' },
    });
    return org;
  });

  res.json({ id: result.id, name: result.name, slug: result.slug, role: 'OWNER' });
});

// --- Org-scoped routes (require X-Organization-Id) ---
router.use(attachOrganization, requireOrganization);

router.get('/current', async (req: OrgRequest, res: Response) => {
  const org = await prisma.organization.findUnique({
    where: { id: req.organizationId },
    select: { id: true, name: true, slug: true, isActive: true, createdAt: true },
  });
  res.json(org);
});

// --- Members ---
router.get('/members', async (req: OrgRequest, res: Response) => {
  const members = await prisma.organizationMember.findMany({
    where: { organizationId: req.organizationId! },
    include: {
      user: { select: { id: true, email: true, name: true } },
    },
    orderBy: { createdAt: 'asc' },
  });
  res.json(members.map(m => ({
    id: m.id,
    userId: m.userId,
    email: m.user.email,
    name: m.user.name,
    role: m.role,
    accessMode: m.accessMode,
    isActive: m.isActive,
    createdAt: m.createdAt,
  })));
});

router.put('/members/:memberId/role', requireOrgRole('OWNER'), async (req: OrgRequest, res: Response) => {
  const memberId = String(req.params.memberId);
  const { role } = req.body;
  if (!role || !['ADMIN', 'MANAGER', 'MEMBER'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role. Must be ADMIN, MANAGER, or MEMBER.' });
  }

  const member = await prisma.organizationMember.findUnique({
    where: { id: memberId },
    select: { organizationId: true, role: true, userId: true },
  });
  if (!member || member.organizationId !== req.organizationId) {
    return res.status(404).json({ error: 'Member not found' });
  }
  if (member.role === 'OWNER') {
    return res.status(403).json({ error: 'Cannot change OWNER role' });
  }

  const updated = await prisma.organizationMember.update({
    where: { id: memberId },
    data: { role },
    include: { user: { select: { email: true, name: true } } },
  });
  res.json({ id: updated.id, role: updated.role, name: updated.user.name });
});

router.put('/members/:memberId/access', requireOrgRole('OWNER', 'ADMIN'), async (req: OrgRequest, res: Response) => {
  const memberId = String(req.params.memberId);
  const { accessMode, pageIds, workspaceIds } = req.body;

  if (!accessMode || !['ALL', 'RESTRICTED'].includes(accessMode)) {
    return res.status(400).json({ error: 'Invalid accessMode' });
  }

  const member = await prisma.organizationMember.findUnique({
    where: { id: memberId },
    select: { organizationId: true, role: true },
  });
  if (!member || member.organizationId !== req.organizationId) {
    return res.status(404).json({ error: 'Member not found' });
  }
  if (member.role === 'OWNER') {
    return res.status(403).json({ error: 'Cannot restrict OWNER access' });
  }

  await prisma.$transaction(async (tx) => {
    await tx.organizationMember.update({ where: { id: memberId }, data: { accessMode } });

    if (accessMode === 'RESTRICTED') {
      await tx.organizationMemberPage.deleteMany({ where: { memberId } });
      await tx.organizationMemberWorkspace.deleteMany({ where: { memberId } });

      if (pageIds?.length) {
        const validPages = await tx.page.findMany({
          where: { id: { in: pageIds }, organizationId: req.organizationId! },
          select: { id: true },
        });
        if (validPages.length) {
          await tx.organizationMemberPage.createMany({
            data: validPages.map((p: { id: string }) => ({ memberId, pageId: p.id })),
            skipDuplicates: true,
          });
        }
      }
      if (workspaceIds?.length) {
        const validWs = await tx.workspace.findMany({
          where: { id: { in: workspaceIds }, organizationId: req.organizationId! },
          select: { id: true },
        });
        if (validWs.length) {
          await tx.organizationMemberWorkspace.createMany({
            data: validWs.map((w: { id: string }) => ({ memberId, workspaceId: w.id })),
            skipDuplicates: true,
          });
        }
      }
    } else {
      await tx.organizationMemberPage.deleteMany({ where: { memberId } });
      await tx.organizationMemberWorkspace.deleteMany({ where: { memberId } });
    }
  });

  res.json({ success: true });
});

router.delete('/members/:memberId', requireOrgRole('OWNER'), async (req: OrgRequest, res: Response) => {
  const memberId = String(req.params.memberId);
  const member = await prisma.organizationMember.findUnique({
    where: { id: memberId },
    select: { organizationId: true, role: true, userId: true },
  });
  if (!member || member.organizationId !== req.organizationId) {
    return res.status(404).json({ error: 'Member not found' });
  }
  if (member.role === 'OWNER') {
    return res.status(403).json({ error: 'Cannot remove OWNER' });
  }

  await prisma.organizationMember.update({ where: { id: memberId }, data: { isActive: false } });
  res.json({ success: true });
});

// --- Invitations ---
router.post('/invitations', requireOrgRole('OWNER', 'ADMIN'), async (req: OrgRequest, res: Response) => {
  const { email, role } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });
  const inviteRole = role && ['ADMIN', 'MANAGER', 'MEMBER'].includes(role) ? role : 'MEMBER';

  const existing = await prisma.organizationMember.findFirst({
    where: { organizationId: req.organizationId!, user: { email }, isActive: true },
  });
  if (existing) return res.status(409).json({ error: 'User is already a member' });

  const pendingInvite = await prisma.organizationInvitation.findFirst({
    where: { organizationId: req.organizationId!, email, status: 'PENDING' },
  });
  if (pendingInvite) return res.status(409).json({ error: 'Invitation already pending' });

  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const invitation = await prisma.organizationInvitation.create({
    data: {
      organizationId: req.organizationId!,
      email,
      role: inviteRole,
      invitedBy: req.userId!,
      expiresAt,
    },
  });

  res.json({ id: invitation.id, email, role: inviteRole, token: invitation.token, expiresAt });
});

router.get('/invitations', requireOrgRole('OWNER', 'ADMIN'), async (req: OrgRequest, res: Response) => {
  const invitations = await prisma.organizationInvitation.findMany({
    where: { organizationId: req.organizationId! },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  res.json(invitations);
});

router.delete('/invitations/:invitationId', requireOrgRole('OWNER', 'ADMIN'), async (req: OrgRequest, res: Response) => {
  const invitationId = String(req.params.invitationId);
  const inv = await prisma.organizationInvitation.findUnique({
    where: { id: invitationId },
    select: { organizationId: true, status: true },
  });
  if (!inv || inv.organizationId !== req.organizationId) {
    return res.status(404).json({ error: 'Invitation not found' });
  }
  if (inv.status !== 'PENDING') {
    return res.status(400).json({ error: 'Can only cancel pending invitations' });
  }
  await prisma.organizationInvitation.update({
    where: { id: invitationId },
    data: { status: 'CANCELLED' },
  });
  res.json({ success: true });
});

// --- AI Credentials (org-scoped, masked) ---
router.get('/ai-credentials', requireOrgRole('OWNER', 'ADMIN'), async (req: OrgRequest, res: Response) => {
  const creds = await prisma.organizationAiCredential.findMany({
    where: { organizationId: req.organizationId! },
  });
  res.json(creds.map(c => ({
    id: c.id,
    provider: c.provider,
    apiKey: maskSecret(c.apiKey),
    isActive: c.isActive,
    createdAt: c.createdAt,
  })));
});

router.put('/ai-credentials/:provider', requireOrgRole('OWNER', 'ADMIN'), async (req: OrgRequest, res: Response) => {
  const provider = String(req.params.provider);
  const { apiKey } = req.body;
  if (!apiKey) return res.status(400).json({ error: 'API key required' });

  const cred = await prisma.organizationAiCredential.upsert({
    where: { organizationId_provider: { organizationId: req.organizationId!, provider } },
    update: { apiKey, isActive: true },
    create: { organizationId: req.organizationId!, provider, apiKey },
  });
  res.json({ id: cred.id, provider, apiKey: maskSecret(apiKey), isActive: true });
});

router.delete('/ai-credentials/:provider', requireOrgRole('OWNER', 'ADMIN'), async (req: OrgRequest, res: Response) => {
  const provider = String(req.params.provider);
  await prisma.organizationAiCredential.deleteMany({
    where: { organizationId: req.organizationId!, provider },
  });
  res.json({ success: true });
});

// --- AI Operation Settings (org-scoped) ---
router.get('/ai-settings', async (req: OrgRequest, res: Response) => {
  const settings = await prisma.organizationAiOperationSetting.findMany({
    where: { organizationId: req.organizationId! },
  });
  res.json(settings);
});

router.put('/ai-settings/:operation', requireOrgRole('OWNER', 'ADMIN'), async (req: OrgRequest, res: Response) => {
  const operation = String(req.params.operation);
  const { provider, model } = req.body;
  if (!provider || !model) return res.status(400).json({ error: 'provider and model required' });

  const setting = await prisma.organizationAiOperationSetting.upsert({
    where: { organizationId_operation: { organizationId: req.organizationId!, operation } },
    update: { provider, model },
    create: { organizationId: req.organizationId!, operation, provider, model },
  });
  res.json(setting);
});

// --- Organization Settings (key-value, org-scoped) ---
const ORG_SETTING_KEYS = [
  'TELEGRAM_BOT_TOKEN', 'TELEGRAM_ADMIN_CHAT_IDS',
  'FACEBOOK_APP_ID', 'FACEBOOK_APP_SECRET',
  'DEFAULT_TIMEZONE',
] as const;

const SECRET_KEYS = new Set([
  'TELEGRAM_BOT_TOKEN', 'FACEBOOK_APP_SECRET',
]);

router.get('/settings', requireOrgRole('OWNER', 'ADMIN'), async (req: OrgRequest, res: Response) => {
  const rows = await prisma.organizationSetting.findMany({
    where: { organizationId: req.organizationId! },
  });
  const result: Record<string, string> = {};
  for (const key of ORG_SETTING_KEYS) {
    const row = rows.find(r => r.key === key);
    if (row) {
      result[key] = SECRET_KEYS.has(key) ? maskSecret(row.value) : row.value;
    } else {
      result[key] = '';
    }
  }
  res.json(result);
});

router.put('/settings', requireOrgRole('OWNER', 'ADMIN'), async (req: OrgRequest, res: Response) => {
  const data = req.body as Record<string, string>;
  const ops = Object.entries(data)
    .filter(([key]) => (ORG_SETTING_KEYS as readonly string[]).includes(key))
    .map(([key, value]) =>
      prisma.organizationSetting.upsert({
        where: { organizationId_key: { organizationId: req.organizationId!, key } },
        update: { value },
        create: { organizationId: req.organizationId!, key, value },
      })
    );
  if (ops.length) await prisma.$transaction(ops);
  res.json({ success: true });
});

export { router as organizationRouter };
