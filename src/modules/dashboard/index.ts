import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { prisma } from '../../utils/db';
import { listProviders, setTextProvider, setImageProvider, generateText, testConnection } from '../content-generator';
import { contentQueue, publishQueue } from '../../queues';
import { getSetting, getSettings, setSettings } from '../settings';

const VIDEO_DIR = path.join(process.cwd(), 'public', 'uploads', 'videos');
if (!fs.existsSync(VIDEO_DIR)) fs.mkdirSync(VIDEO_DIR, { recursive: true });

const videoUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, VIDEO_DIR),
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`),
  }),
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['.mp4', '.mov', '.avi', '.webm', '.mkv'];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowed.includes(ext));
  },
});

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
  const { status, pageId, limit = '50', offset = '0', search, dateFrom, dateTo } = req.query;
  const where: Record<string, unknown> = {};
  if (status) where.status = String(status);
  if (pageId) where.pageId = String(pageId);
  if (search) where.topic = { contains: String(search), mode: 'insensitive' };
  if (dateFrom || dateTo) {
    const dateFilter: Record<string, Date> = {};
    if (dateFrom) dateFilter.gte = new Date(String(dateFrom));
    if (dateTo) {
      const end = new Date(String(dateTo));
      end.setHours(23, 59, 59, 999);
      dateFilter.lte = end;
    }
    where.scheduledAt = dateFilter;
  }

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

router.delete('/content/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    await prisma.approvalLog.deleteMany({ where: { contentItemId: id } });
    await prisma.contentItem.delete({ where: { id } });
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to delete' });
  }
});

router.patch('/content/:id', async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const { scheduledAt, status, topic, notes, contentType, imageDescriptions } = req.body;
  const data: Record<string, unknown> = {};
  if (scheduledAt) data.scheduledAt = new Date(scheduledAt);
  if (status) data.status = status;
  if (topic !== undefined) data.topic = topic;
  if (notes !== undefined) data.notes = notes;
  if (contentType) data.contentType = contentType;
  if (imageDescriptions !== undefined) data.imageDescriptions = imageDescriptions;
  const item = await prisma.contentItem.update({ where: { id }, data, include: { page: true, campaign: true } });
  res.json(item);
});

router.post('/content', async (req: Request, res: Response) => {
  try {
    const { pageId, topic, contentType, scheduledAt, notes, imageDescriptions, campaignId } = req.body;
    if (!pageId || !topic || !scheduledAt) {
      return res.status(400).json({ error: 'Thiếu thông tin: pageId, topic, scheduledAt là bắt buộc' });
    }
    let cId = campaignId;
    if (!cId) {
      let defaultCampaign = await prisma.campaign.findFirst({ where: { name: 'Thủ công', isActive: true } });
      if (!defaultCampaign) {
        defaultCampaign = await prisma.campaign.create({
          data: { name: 'Thủ công', description: 'Content tạo thủ công', startDate: new Date(), userId: req.body.userId || 'system' },
        });
      }
      cId = defaultCampaign.id;
    }
    const item = await prisma.contentItem.create({
      data: {
        campaignId: cId,
        pageId,
        topic,
        contentType: contentType || 'IMAGE',
        scheduledAt: new Date(scheduledAt),
        notes: notes || null,
        imageDescriptions: imageDescriptions || null,
        status: 'DRAFT',
      },
      include: { page: true, campaign: true },
    });
    res.json(item);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to create content' });
  }
});

// Video upload
router.post('/content/:id/upload-video', videoUpload.single('video'), async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!req.file) return res.status(400).json({ error: 'Không có file video' });

    const appUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
    const videoUrl = `${appUrl}/uploads/videos/${req.file.filename}`;

    await prisma.contentItem.update({
      where: { id },
      data: { generatedVideoUrl: videoUrl },
    });

    res.json({ success: true, videoUrl, filename: req.file.filename, size: req.file.size });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Upload failed' });
  }
});

router.delete('/content/:id/video', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const item = await prisma.contentItem.findUnique({ where: { id }, select: { generatedVideoUrl: true } });
    if (item?.generatedVideoUrl?.includes('/uploads/videos/')) {
      const filename = item.generatedVideoUrl.split('/uploads/videos/').pop();
      if (filename) {
        const filePath = path.join(VIDEO_DIR, filename);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      }
    }
    await prisma.contentItem.update({ where: { id }, data: { generatedVideoUrl: null } });
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Delete failed' });
  }
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

    const apiModels = (data.models || [])
      .filter(m => m.name.includes('image') || m.description?.toLowerCase().includes('image'))
      .map(m => ({ id: m.name.replace('models/', ''), name: m.displayName, description: m.description }));

    const knownModels = [
      { id: 'gemini-3.1-flash-image', name: 'Nano Banana 2', description: 'Mới nhất, hỗ trợ 4K, chỉnh sửa ảnh (2026)' },
      { id: 'gemini-3.1-flash-lite-image', name: 'Nano Banana 2 Lite', description: 'Nhanh nhất, tiết kiệm chi phí (2026)' },
      { id: 'imagen-4', name: 'Imagen 4', description: 'Google Imagen — chất lượng cao' },
    ];
    const apiIds = new Set(apiModels.map(m => m.id));
    const merged = [...knownModels.filter(m => !apiIds.has(m.id)), ...apiModels];

    res.json(merged);
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

// OpenAI image models
router.get('/openai-image-models', async (_req: Request, res: Response) => {
  try {
    const apiKey = (await getSetting('OPENAI_API_KEY')) || process.env.OPENAI_API_KEY;
    if (!apiKey) return res.status(400).json({ error: 'OPENAI_API_KEY chưa được cấu hình' });

    const models = [
      { id: 'gpt-image-2.5-sunburst', name: 'GPT Image 2.5 Sunburst', description: '#1 — editing chính xác, chi tiết sắc nét (9/2026)' },
      { id: 'gpt-image-2.5-flare', name: 'GPT Image 2.5 Flare', description: 'Nhanh, chất lượng cao, dùng hàng ngày (9/2026)' },
      { id: 'gpt-image-2', name: 'GPT Image 2', description: 'Chất lượng rất cao (2026)' },
      { id: 'gpt-image-1', name: 'GPT Image 1', description: 'Chất lượng tốt (2025)' },
      { id: 'dall-e-3', name: 'DALL-E 3', description: 'Text in images, ổn định' },
    ];
    res.json(models);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to list models' });
  }
});

router.post('/test-openai-image-model', async (req: Request, res: Response) => {
  try {
    const { model } = req.body;
    if (!model) return res.status(400).json({ error: 'Chưa chọn model' });

    const apiKey = (await getSetting('OPENAI_API_KEY')) || process.env.OPENAI_API_KEY;
    if (!apiKey) return res.status(400).json({ error: 'OPENAI_API_KEY chưa được cấu hình' });

    const OpenAI = (await import('openai')).default;
    const client = new OpenAI({ apiKey });
    const genParams: Record<string, unknown> = {
      model,
      prompt: 'A simple blue circle on white background, minimal',
      size: '1024x1024',
      n: 1,
    };
    if (model.startsWith('dall-e')) {
      genParams.quality = 'standard';
    } else {
      genParams.quality = 'low';
    }
    const response = await client.images.generate(genParams as unknown as Parameters<typeof client.images.generate>[0]);

    if (response.data?.[0]?.url || response.data?.[0]?.b64_json) {
      res.json({ success: true, message: `Model ${model} tạo ảnh thành công!` });
    } else {
      res.json({ success: false, error: `Model ${model} không trả về ảnh` });
    }
  } catch (err) {
    res.json({ success: false, error: err instanceof Error ? err.message : 'Test failed' });
  }
});

router.post('/test-connection', async (req: Request, res: Response) => {
  try {
    const { type } = req.body;
    if (!['text', 'image'].includes(type)) {
      return res.status(400).json({ ok: false, error: 'Type phải là text hoặc image' });
    }
    const result = await testConnection(type);
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed' });
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
  res.json({ settings: masked });
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
