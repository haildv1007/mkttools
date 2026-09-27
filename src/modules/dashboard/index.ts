import { Prisma } from '@prisma/client';
import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { prisma } from '../../utils/db';
import { listProviders, setTextProvider, setImageProvider, generateText, testConnection } from '../content-generator';
import { contentQueue, publishQueue } from '../../queues';
import { getSetting, getSettings, setSettings } from '../settings';

const UPLOAD_DIR = path.join(process.cwd(), 'public', 'uploads');
const VIDEO_DIR = path.join(UPLOAD_DIR, 'videos');
const IMAGE_DIR = path.join(UPLOAD_DIR, 'images');
if (!fs.existsSync(VIDEO_DIR)) fs.mkdirSync(VIDEO_DIR, { recursive: true });
if (!fs.existsSync(IMAGE_DIR)) fs.mkdirSync(IMAGE_DIR, { recursive: true });

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

const imageUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, IMAGE_DIR),
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`),
  }),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowed.includes(ext));
  },
});

const router = Router();

// --- Facebook insights cache ---
const fbCache = new Map<string, { data: unknown; ts: number }>();
const FB_CACHE_TTL = 5 * 60 * 1000;

router.get('/stats', async (_req: Request, res: Response) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const [
      totalPages,
      totalCampaigns,
      totalContent,
      statusBreakdown,
      sourceBreakdown,
      contentTypeBreakdown,
      todayCreated,
      todayPublished,
      providers,
    ] = await Promise.all([
      prisma.page.count({ where: { isActive: true } }),
      prisma.campaign.count({ where: { isActive: true } }),
      prisma.contentItem.count(),
      prisma.contentItem.groupBy({ by: ['status'], _count: true }),
      prisma.contentItem.groupBy({ by: ['source'], _count: true }),
      prisma.contentItem.groupBy({ by: ['contentType'], _count: true }),
      prisma.contentItem.count({ where: { createdAt: { gte: today, lt: tomorrow } } }),
      prisma.contentItem.count({ where: { publishedAt: { gte: today, lt: tomorrow } } }),
      listProviders(),
    ]);

    const statusMap = Object.fromEntries(statusBreakdown.map(s => [s.status, s._count]));
    const sourceMap = Object.fromEntries(sourceBreakdown.map(s => [s.source, s._count]));
    const typeMap = Object.fromEntries(contentTypeBreakdown.map(s => [s.contentType, s._count]));
    const published = statusMap['PUBLISHED'] ?? 0;
    const successRate = totalContent > 0 ? Math.round((published / totalContent) * 10000) / 100 : 0;

    res.json({
      totalPages,
      totalCampaigns,
      totalContent,
      statusBreakdown: statusMap,
      sourceBreakdown: sourceMap,
      contentTypeBreakdown: typeMap,
      todayCreated,
      todayPublished,
      successRate,
      providers,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to fetch stats' });
  }
});

router.get('/stats/timeline', async (req: Request, res: Response) => {
  try {
    const days = Math.max(1, Math.min(365, parseInt(req.query.days as string, 10) || 30));

    const rows = await prisma.$queryRaw<Array<{ date: string; created: number; published: number }>>(
      Prisma.sql`
        SELECT DATE("created_at") as date,
               COUNT(*)::int as created,
               SUM(CASE WHEN status = 'PUBLISHED' THEN 1 ELSE 0 END)::int as published
        FROM content_items
        WHERE "created_at" >= NOW() - make_interval(days => ${days})
        GROUP BY DATE("created_at")
        ORDER BY date
      `
    );

    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to fetch timeline' });
  }
});

router.get('/stats/campaigns', async (_req: Request, res: Response) => {
  try {
    const campaigns = await prisma.campaign.findMany({
      where: { isActive: true },
      include: {
        contentItems: {
          select: { status: true, pageId: true },
        },
      },
    });

    const results = await Promise.all(
      campaigns.map(async (campaign) => {
        const items = campaign.contentItems;
        const totalContent = items.length;
        const published = items.filter(i => i.status === 'PUBLISHED').length;
        const draft = items.filter(i => i.status === 'DRAFT').length;
        const pending = items.filter(i => i.status === 'PENDING_REVIEW').length;
        const failed = items.filter(i => i.status === 'FAILED').length;
        const successRate = totalContent > 0 ? Math.round((published / totalContent) * 10000) / 100 : 0;

        // Find the most-used page
        const pageCounts = new Map<string, number>();
        for (const item of items) {
          pageCounts.set(item.pageId, (pageCounts.get(item.pageId) ?? 0) + 1);
        }
        let topPageName: string | null = null;
        if (pageCounts.size > 0) {
          const topPageId = [...pageCounts.entries()].sort((a, b) => b[1] - a[1])[0][0];
          const topPage = await prisma.page.findUnique({ where: { id: topPageId }, select: { name: true } });
          topPageName = topPage?.name ?? null;
        }

        return {
          id: campaign.id,
          name: campaign.name,
          startDate: campaign.startDate,
          endDate: campaign.endDate,
          totalContent,
          published,
          draft,
          pending,
          failed,
          successRate,
          topPageName,
        };
      })
    );

    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to fetch campaign stats' });
  }
});

router.get('/stats/pages', async (_req: Request, res: Response) => {
  try {
    const pages = await prisma.page.findMany({
      where: { isActive: true },
      include: {
        _count: { select: { contentItems: true } },
        contentItems: {
          where: { status: 'PUBLISHED' },
          select: { id: true },
        },
      },
    });

    const results = pages.map(page => {
      const totalContent = page._count.contentItems;
      const published = page.contentItems.length;
      const successRate = totalContent > 0 ? Math.round((published / totalContent) * 10000) / 100 : 0;
      return {
        id: page.id,
        name: page.name,
        platform: page.platform,
        externalId: page.externalId,
        totalContent,
        published,
        successRate,
      };
    });

    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to fetch page stats' });
  }
});

router.get('/stats/upcoming', async (_req: Request, res: Response) => {
  try {
    const now = new Date();
    const nextWeek = new Date(now);
    nextWeek.setDate(nextWeek.getDate() + 7);

    const items = await prisma.contentItem.findMany({
      where: {
        scheduledAt: { gte: now, lte: nextWeek },
        status: { in: ['DRAFT', 'PENDING_REVIEW', 'APPROVED', 'GENERATING'] },
      },
      include: {
        page: { select: { id: true, name: true, platform: true } },
        campaign: { select: { id: true, name: true } },
      },
      orderBy: { scheduledAt: 'asc' },
      take: 20,
    });

    res.json(items);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to fetch upcoming content' });
  }
});

router.get('/stats/recent-published', async (_req: Request, res: Response) => {
  try {
    const items = await prisma.contentItem.findMany({
      where: { status: 'PUBLISHED' },
      include: {
        page: { select: { id: true, name: true, platform: true } },
        campaign: { select: { id: true, name: true } },
      },
      orderBy: { publishedAt: 'desc' },
      take: 10,
    });

    res.json(items);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to fetch recent published' });
  }
});

router.get('/stats/fb-insights', async (_req: Request, res: Response) => {
  try {
    // Get all published content with socialPostId
    const publishedItems = await prisma.contentItem.findMany({
      where: {
        status: 'PUBLISHED',
        socialPostId: { not: null },
      },
      select: {
        id: true,
        socialPostId: true,
        topic: true,
        publishedAt: true,
        pageId: true,
        page: {
          select: { id: true, name: true, externalId: true, accessToken: true, platform: true },
        },
      },
    });

    // Filter to Facebook only and group by page
    const byPage = new Map<string, { page: typeof publishedItems[0]['page']; items: typeof publishedItems }>();
    for (const item of publishedItems) {
      if (item.page.platform !== 'FACEBOOK') continue;
      if (!item.socialPostId) continue;
      const existing = byPage.get(item.pageId);
      if (existing) {
        existing.items.push(item);
      } else {
        byPage.set(item.pageId, { page: item.page, items: [item] });
      }
    }

    const results: Array<{
      pageId: string;
      pageName: string;
      followers: number | null;
      fanCount: number | null;
      totalReactions: number;
      totalComments: number;
      totalShares: number;
      totalReach: number;
      posts: Array<{
        contentItemId: string;
        socialPostId: string;
        topic: string;
        publishedAt: Date | null;
        reactions: number;
        comments: number;
        shares: number;
        reach: number;
        engagedUsers: number;
      }>;
      errors: string[];
    }> = [];

    for (const [pageId, { page, items }] of byPage) {
      const pageResult = {
        pageId,
        pageName: page.name,
        followers: null as number | null,
        fanCount: null as number | null,
        totalReactions: 0,
        totalComments: 0,
        totalShares: 0,
        totalReach: 0,
        posts: [] as Array<{
          contentItemId: string;
          socialPostId: string;
          topic: string;
          publishedAt: Date | null;
          reactions: number;
          comments: number;
          shares: number;
          reach: number;
          engagedUsers: number;
        }>,
        errors: [] as string[],
      };

      const cacheKey = `page_${pageId}`;
      const cached = fbCache.get(cacheKey);
      if (cached && Date.now() - cached.ts < FB_CACHE_TTL) {
        results.push(cached.data as typeof pageResult);
        continue;
      }

      const token = page.accessToken;

      // Fetch page-level metrics
      try {
        const pageRes = await fetch(
          `https://graph.facebook.com/v21.0/${page.externalId}?fields=followers_count,fan_count&access_token=${encodeURIComponent(token)}`
        );
        if (pageRes.ok) {
          const pageData = await pageRes.json() as { followers_count?: number; fan_count?: number };
          pageResult.followers = pageData.followers_count ?? null;
          pageResult.fanCount = pageData.fan_count ?? null;
        } else {
          const errBody = await pageRes.json().catch(() => ({})) as { error?: { message?: string } };
          pageResult.errors.push(`Page metrics: ${errBody?.error?.message ?? pageRes.statusText}`);
        }
      } catch (err) {
        pageResult.errors.push(`Page metrics: ${err instanceof Error ? err.message : 'Network error'}`);
      }

      // Batch-fetch post metrics (Facebook supports up to 50 IDs per request)
      const postIds = items.map(i => i.socialPostId!);
      const batches: string[][] = [];
      for (let i = 0; i < postIds.length; i += 50) {
        batches.push(postIds.slice(i, i + 50));
      }

      const postDataMap = new Map<string, {
        reactions: number; comments: number; shares: number; reach: number; engagedUsers: number;
      }>();

      for (const batch of batches) {
        try {
          const ids = batch.join(',');
          const url = `https://graph.facebook.com/v21.0/?ids=${encodeURIComponent(ids)}&fields=likes.summary(true),comments.summary(true),shares,insights.metric(post_impressions,post_engaged_users)&access_token=${encodeURIComponent(token)}`;
          const batchRes = await fetch(url);
          if (batchRes.ok) {
            const data = await batchRes.json() as Record<string, {
              likes?: { summary?: { total_count?: number } };
              comments?: { summary?: { total_count?: number } };
              shares?: { count?: number };
              insights?: { data?: Array<{ name: string; values?: Array<{ value: number }> }> };
            }>;
            for (const [postId, postInfo] of Object.entries(data)) {
              const reactions = postInfo.likes?.summary?.total_count ?? 0;
              const comments = postInfo.comments?.summary?.total_count ?? 0;
              const shares = postInfo.shares?.count ?? 0;
              let reach = 0;
              let engagedUsers = 0;
              if (postInfo.insights?.data) {
                for (const metric of postInfo.insights.data) {
                  const val = metric.values?.[0]?.value ?? 0;
                  if (metric.name === 'post_impressions') reach = val;
                  if (metric.name === 'post_engaged_users') engagedUsers = val;
                }
              }
              postDataMap.set(postId, { reactions, comments, shares, reach, engagedUsers });
            }
          } else {
            const errBody = await batchRes.json().catch(() => ({})) as { error?: { message?: string } };
            pageResult.errors.push(`Post metrics batch: ${errBody?.error?.message ?? batchRes.statusText}`);
          }
        } catch (err) {
          pageResult.errors.push(`Post metrics batch: ${err instanceof Error ? err.message : 'Network error'}`);
        }
      }

      // Assemble per-post results
      for (const item of items) {
        const metrics = postDataMap.get(item.socialPostId!) ?? {
          reactions: 0, comments: 0, shares: 0, reach: 0, engagedUsers: 0,
        };
        pageResult.totalReactions += metrics.reactions;
        pageResult.totalComments += metrics.comments;
        pageResult.totalShares += metrics.shares;
        pageResult.totalReach += metrics.reach;
        pageResult.posts.push({
          contentItemId: item.id,
          socialPostId: item.socialPostId!,
          topic: item.topic,
          publishedAt: item.publishedAt,
          ...metrics,
        });
      }

      fbCache.set(cacheKey, { data: pageResult, ts: Date.now() });
      results.push(pageResult);
    }

    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to fetch Facebook insights' });
  }
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
router.get('/pages', async (req: Request, res: Response) => {
  const showAll = req.query.all === 'true';
  const pages = await prisma.page.findMany({
    where: showAll ? {} : { isActive: true },
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
  const { status, pageId, limit = '50', offset = '0', search, dateFrom, dateTo, source, campaignId, contentType } = req.query;
  const where: Record<string, unknown> = {};
  if (status) where.status = String(status);
  if (pageId) where.pageId = String(pageId);
  if (source) where.source = String(source);
  if (campaignId) where.campaignId = String(campaignId);
  if (contentType) where.contentType = String(contentType);
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
  const { scheduledAt, status, topic, notes, contentType, imageDescriptions, generatedText, imageUrl, videoUrl } = req.body;
  const data: Record<string, unknown> = {};
  if (scheduledAt) data.scheduledAt = new Date(scheduledAt);
  if (status) data.status = status;
  if (topic !== undefined) data.topic = topic;
  if (notes !== undefined) data.notes = notes;
  if (contentType) data.contentType = contentType;
  if (imageDescriptions !== undefined) data.imageDescriptions = imageDescriptions;
  if (generatedText !== undefined) data.generatedText = generatedText;
  if (imageUrl !== undefined) data.generatedImageUrl = imageUrl;
  if (videoUrl !== undefined) data.generatedVideoUrl = videoUrl;
  const item = await prisma.contentItem.update({ where: { id }, data, include: { page: true, campaign: true } });
  res.json(item);
});

router.post('/content', async (req: Request, res: Response) => {
  try {
    const { pageId, topic, contentType, scheduledAt, notes, imageDescriptions, campaignId, generatedText, imageUrl, videoUrl, imageUrls } = req.body;
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
    const hasContent = !!(generatedText || imageUrl || videoUrl);
    const item = await prisma.contentItem.create({
      data: {
        campaignId: cId,
        pageId,
        topic,
        contentType: contentType || 'IMAGE',
        scheduledAt: new Date(scheduledAt),
        notes: notes || null,
        imageDescriptions: imageDescriptions || null,
        generatedText: generatedText || null,
        generatedImageUrl: imageUrl || null,
        generatedImages: imageUrls?.length > 0 ? JSON.parse(JSON.stringify(imageUrls.map((u: string) => ({ url: u })))) : undefined,
        generatedVideoUrl: videoUrl || null,
        source: hasContent ? 'MANUAL' : 'AI',
        status: hasContent ? 'PENDING_REVIEW' : 'DRAFT',
      },
      include: { page: true, campaign: true },
    });
    res.json(item);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to create content' });
  }
});

// Approval actions
router.post('/content/:id/approve', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const item = await prisma.contentItem.update({
      where: { id },
      data: { status: 'APPROVED' },
      include: { page: true, campaign: true },
    });
    await prisma.approvalLog.create({
      data: { contentItemId: id, userId: req.body.userId || 'system', action: 'APPROVE' },
    });
    res.json(item);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to approve' });
  }
});

router.post('/content/:id/reject', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const item = await prisma.contentItem.update({
      where: { id },
      data: { status: 'CANCELLED' },
      include: { page: true, campaign: true },
    });
    await prisma.approvalLog.create({
      data: { contentItemId: id, userId: req.body.userId || 'system', action: 'REJECT', feedback: req.body.feedback },
    });
    res.json(item);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to reject' });
  }
});

router.post('/content/:id/request-edit', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const item = await prisma.contentItem.update({
      where: { id },
      data: { status: 'REVISION_REQUESTED' },
      include: { page: true, campaign: true },
    });
    await prisma.approvalLog.create({
      data: { contentItemId: id, userId: req.body.userId || 'system', action: 'REQUEST_EDIT', feedback: req.body.feedback },
    });
    res.json(item);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed' });
  }
});

// Video upload
// Image upload
router.post('/content/:id/upload-image', imageUpload.single('image'), async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!req.file) return res.status(400).json({ error: 'Không có file ảnh' });

    const imageUrl = `/uploads/images/${req.file.filename}`;

    await prisma.contentItem.update({
      where: { id },
      data: { generatedImageUrl: imageUrl },
    });

    res.json({ success: true, imageUrl, filename: req.file.filename, size: req.file.size });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Upload failed' });
  }
});

router.post('/content/:id/upload-images', imageUpload.array('images', 10), async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const files = req.files as Express.Multer.File[];
    if (!files || files.length === 0) return res.status(400).json({ error: 'Không có file ảnh' });

    const images = files.map(f => ({
      url: `/uploads/images/${f.filename}`,
      localPath: f.path,
    }));

    await prisma.contentItem.update({
      where: { id },
      data: {
        generatedImageUrl: images[0].url,
        generatedImages: JSON.parse(JSON.stringify(images)),
      },
    });

    res.json({ success: true, images });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Upload failed' });
  }
});

router.post('/content/:id/upload-video', videoUpload.single('video'), async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!req.file) return res.status(400).json({ error: 'Không có file video' });

    const videoUrl = `/uploads/videos/${req.file.filename}`;

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
