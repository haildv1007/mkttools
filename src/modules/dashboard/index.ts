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
    providers: await listProviders(),
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

// Facebook token exchange: short-lived → long-lived → page tokens
router.post('/pages/fb-token-exchange', async (req: Request, res: Response) => {
  try {
    const { shortToken } = req.body;
    if (!shortToken) return res.status(400).json({ error: 'Thiếu short-lived token' });

    const settings = await getSettings();
    const appId = settings.FACEBOOK_APP_ID;
    const appSecret = settings.FACEBOOK_APP_SECRET;
    if (!appId || !appSecret) {
      return res.status(400).json({ error: 'Chưa cấu hình Facebook App ID / Secret trong Cài đặt hệ thống' });
    }

    // Step 1: Exchange for long-lived user token
    const llRes = await fetch(
      `https://graph.facebook.com/v21.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${shortToken}`
    );
    const llData = await llRes.json() as { access_token?: string; error?: { message: string } };
    if (llData.error || !llData.access_token) {
      return res.status(400).json({ error: llData.error?.message || 'Không thể đổi token' });
    }

    // Step 2: Get page tokens (these are permanent)
    const pagesRes = await fetch(
      `https://graph.facebook.com/v21.0/me/accounts?fields=id,name,access_token,picture&access_token=${llData.access_token}`
    );
    const pagesData = await pagesRes.json() as { data?: Array<{ id: string; name: string; access_token: string; picture?: { data?: { url?: string } } }>; error?: { message: string; code?: number } };
    if (pagesData.error || !pagesData.data) {
      const fbErr = pagesData.error?.message || '';
      if (fbErr.includes('nonexisting field') || pagesData.error?.code === 100) {
        return res.status(400).json({
          error: 'Token chưa có quyền truy cập Pages. Vào Graph API Explorer → bấm "Add a Permission" → chọn pages_show_list, pages_read_engagement, pages_manage_posts → bấm "Generate Access Token" lại rồi thử lại.',
        });
      }
      return res.status(400).json({ error: fbErr || 'Không thể lấy danh sách pages' });
    }

    res.json({ pages: pagesData.data });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Lỗi đổi token' });
  }
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
router.get('/providers', async (_req: Request, res: Response) => {
  res.json(await listProviders());
});

router.put('/providers/text', async (req: Request, res: Response) => {
  try {
    setTextProvider(req.body.provider);
    res.json({ success: true, providers: await listProviders() });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Invalid provider' });
  }
});

router.put('/providers/image', async (req: Request, res: Response) => {
  try {
    setImageProvider(req.body.provider);
    res.json({ success: true, providers: await listProviders() });
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

// Gemini image models
router.get('/gemini-image-models', async (_req: Request, res: Response) => {
  try {
    const apiKey = (await getSetting('GEMINI_API_KEY')) || process.env.GEMINI_API_KEY;
    if (!apiKey) return res.status(400).json({ error: 'GEMINI_API_KEY chưa được cấu hình' });

    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
    const data = await r.json() as { models?: Array<{ name: string; displayName: string; description: string; supportedGenerationMethods: string[] }> };

    const imageModels = (data.models || [])
      .filter(m => m.name.includes('image') || m.description?.toLowerCase().includes('image'))
      .map(m => ({ id: m.name.replace('models/', ''), name: m.displayName, description: m.description }));

    res.json(imageModels);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to list models' });
  }
});

router.post('/test-image-model', async (req: Request, res: Response) => {
  try {
    const { model } = req.body;
    if (!model) return res.status(400).json({ error: 'Chưa chọn model' });

    const apiKey = (await getSetting('GEMINI_API_KEY')) || process.env.GEMINI_API_KEY;
    if (!apiKey) return res.status(400).json({ error: 'GEMINI_API_KEY chưa được cấu hình' });

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: 'Generate a simple test image: a blue circle on white background' }] }],
        generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
      }),
    });

    const data = await r.json() as { candidates?: Array<{ content: { parts: Array<{ inlineData?: { mimeType: string } }> } }>; error?: { message: string } };

    if (data.error) {
      return res.json({ success: false, error: data.error.message });
    }

    const hasImage = data.candidates?.[0]?.content?.parts?.some(p => p.inlineData);
    if (hasImage) {
      res.json({ success: true, message: `Model ${model} tạo ảnh thành công!` });
    } else {
      res.json({ success: false, error: `Model ${model} không trả về ảnh` });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Test failed' });
  }
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
      if (value !== undefined && typeof value === 'string' && !value.startsWith('••••')) {
        cleaned[key] = value;
      }
    }
    console.log('[Settings] Saving keys:', Object.keys(cleaned));
    console.log('[Settings] AI_IMAGE_PROVIDER =', cleaned['AI_IMAGE_PROVIDER']);
    await setSettings(cleaned);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to save settings' });
  }
});

export { router as dashboardRouter };
