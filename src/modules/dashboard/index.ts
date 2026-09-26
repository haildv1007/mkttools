import { Router, Request, Response } from 'express';
import { prisma } from '../../utils/db';
import { listProviders, setTextProvider, setImageProvider, generateText } from '../content-generator';
import { contentQueue, publishQueue } from '../../queues';
import { getSettings, setSettings } from '../settings';
const router = Router();

router.get('/stats', async (_req: Request, res: Response) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const [totalPages, totalCampaigns, todayStats, allTimeStats] = await Promise.all([
    prisma.page.count({ where: { isActive: true } }),
    prisma.campaign.count({ where: { isActive: true } }),
    prisma.contentItem.groupBy({
      by: ['status'],
      where: { scheduledAt: { gte: today, lt: tomorrow } },
      _count: true,
    }),
    prisma.contentItem.groupBy({
      by: ['status'],
      _count: true,
    }),
  ]);

  const todayMap = Object.fromEntries(todayStats.map(s => [s.status, s._count]));
  const allMap = Object.fromEntries(allTimeStats.map(s => [s.status, s._count]));

  res.json({
    pages: totalPages,
    campaigns: totalCampaigns,
    today: todayMap,
    allTime: allMap,
    providers: listProviders(),
  });
});

router.get('/calendar', async (req: Request, res: Response) => {
  const { from, to, pageId } = req.query;
  const where: Record<string, unknown> = {};

  if (from && to) {
    where.scheduledAt = { gte: new Date(from as string), lte: new Date(to as string) };
  }
  if (pageId) where.pageId = String(pageId);

  const items = await prisma.contentItem.findMany({
    where,
    include: { page: true, campaign: true },
    orderBy: { scheduledAt: 'asc' },
  });

  res.json(items);
});

// Pages CRUD
router.get('/pages', async (_req: Request, res: Response) => {
  const pages = await prisma.page.findMany({
    include: { _count: { select: { contentItems: true } } },
    orderBy: { createdAt: 'desc' },
  });
  res.json(pages);
});

router.post('/pages', async (req: Request, res: Response) => {
  try {
    const page = await prisma.page.create({ data: req.body });
    res.json(page);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to create page' });
  }
});

router.put('/pages/:id', async (req: Request, res: Response) => {
  const page = await prisma.page.update({ where: { id: String(req.params.id) }, data: req.body });
  res.json(page);
});

router.delete('/pages/:id', async (req: Request, res: Response) => {
  await prisma.page.update({ where: { id: String(req.params.id) }, data: { isActive: false } });
  res.json({ success: true });
});

// Content items
router.get('/content', async (req: Request, res: Response) => {
  const { status, pageId, limit = '50', offset = '0' } = req.query;
  const where: Record<string, unknown> = {};
  if (status) where.status = String(status);
  if (pageId) where.pageId = String(pageId);

  const [items, total] = await Promise.all([
    prisma.contentItem.findMany({
      where,
      include: { page: true, campaign: true },
      orderBy: { scheduledAt: 'desc' },
      take: Number(limit),
      skip: Number(offset),
    }),
    prisma.contentItem.count({ where }),
  ]);

  res.json({ items, total });
});

router.post('/content/generate-all-drafts', async (_req: Request, res: Response) => {
  const drafts = await prisma.contentItem.findMany({
    where: { status: 'DRAFT' },
    take: 50,
  });

  for (const item of drafts) {
    await contentQueue.add('generate', { contentItemId: item.id }, {
      jobId: `gen-${item.id}-${Date.now()}`,
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
    });
  }

  res.json({ success: true, queued: drafts.length, message: `Queued ${drafts.length} drafts for generation` });
});

router.post('/content/:id/regenerate', async (req: Request, res: Response) => {
  const { id } = req.params;
  await contentQueue.add('generate', { contentItemId: id }, {
    jobId: `regen-${id}-${Date.now()}`,
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
  });
  res.json({ success: true, message: 'Queued for regeneration' });
});

router.post('/content/:id/publish-now', async (req: Request, res: Response) => {
  const { id } = req.params;
  await publishQueue.add('publish', { contentItemId: id }, {
    jobId: `pub-now-${id}-${Date.now()}`,
  });
  res.json({ success: true, message: 'Queued for publishing' });
});

router.patch('/content/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { scheduledAt, status } = req.body;
  const data: Record<string, unknown> = {};
  if (scheduledAt) data.scheduledAt = new Date(scheduledAt);
  if (status) data.status = status;
  const item = await prisma.contentItem.update({ where: { id }, data });
  res.json(item);
});

// AI Provider management
router.get('/providers', (_req: Request, res: Response) => {
  res.json(listProviders());
});

router.put('/providers/text', (req: Request, res: Response) => {
  try {
    setTextProvider(req.body.provider);
    res.json({ success: true, providers: listProviders() });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Invalid provider' });
  }
});

router.put('/providers/image', (req: Request, res: Response) => {
  try {
    setImageProvider(req.body.provider);
    res.json({ success: true, providers: listProviders() });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Invalid provider' });
  }
});

// Test AI generation
router.post('/test-generate', async (req: Request, res: Response) => {
  try {
    const { topic, pageName, contentType } = req.body;
    const result = await generateText({
      topic: topic || 'Khuyến mãi cuối tuần',
      pageName: pageName || 'Test Page',
      contentType: contentType || 'post',
    });
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Generation failed' });
  }
});

// Users
router.get('/users', async (_req: Request, res: Response) => {
  const users = await prisma.user.findMany({
    select: { id: true, email: true, name: true, role: true, telegramChatId: true, isActive: true, createdAt: true },
  });
  res.json(users);
});

// Settings CRUD
router.get('/settings', async (_req: Request, res: Response) => {
  const settings = await getSettings();
  const masked: Record<string, string> = {};
  for (const [key, value] of Object.entries(settings)) {
    if (key.includes('KEY') || key.includes('SECRET') || key.includes('TOKEN')) {
      masked[key] = value ? '••••' + value.slice(-6) : '';
    } else {
      masked[key] = value;
    }
  }
  res.json({ settings: masked, raw: settings });
});

router.put('/settings', async (req: Request, res: Response) => {
  try {
    const data = req.body as Record<string, string>;
    const cleaned: Record<string, string> = {};
    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined && !value.startsWith('••••')) {
        cleaned[key] = value;
      }
    }
    await setSettings(cleaned);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to save settings' });
  }
});

export { router as dashboardRouter };
