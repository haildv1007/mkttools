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

// --- Helper: fetch FB metrics for a set of published content items ---
interface FbPostMetrics {
  contentItemId: string;
  socialPostId: string;
  topic: string;
  publishedAt: Date | null;
  campaignId: string;
  pageId: string;
  pageName: string;
  pageExternalId: string;
  reactions: number;
  comments: number;
  shares: number;
  reach: number;
  engagedUsers: number;
}

async function readMetricsFromDb(
  items: Array<{
    id: string;
    socialPostId: string | null;
    topic: string;
    publishedAt: Date | null;
    pageId: string;
    campaignId: string;
    metrics?: unknown;
    page: { id: string; name: string; externalId: string; accessToken: string; platform: string };
  }>
): Promise<{ metrics: FbPostMetrics[]; errors: string[]; lastSync: string | null }> {
  const allMetrics: FbPostMetrics[] = [];
  let lastSync: string | null = null;

  for (const item of items) {
    if (item.page.platform !== 'FACEBOOK' || !item.socialPostId) continue;
    const saved = item.metrics as { fb_reactions?: number; fb_comments?: number; fb_shares?: number; fb_impressions?: number | null; fb_engaged_users?: number | null; fb_synced_at?: string } | null;
    const reactions = saved?.fb_reactions ?? 0;
    const comments = saved?.fb_comments ?? 0;
    const shares = saved?.fb_shares ?? 0;
    const reach = saved?.fb_impressions ?? null;
    const engagedUsers = saved?.fb_engaged_users ?? null;
    if (saved?.fb_synced_at && (!lastSync || saved.fb_synced_at > lastSync)) {
      lastSync = saved.fb_synced_at;
    }
    allMetrics.push({
      contentItemId: item.id, socialPostId: item.socialPostId, topic: item.topic,
      publishedAt: item.publishedAt, campaignId: item.campaignId, pageId: item.pageId,
      pageName: item.page.name, pageExternalId: item.page.externalId,
      reactions, comments, shares, reach: reach ?? 0, engagedUsers: engagedUsers ?? 0,
    });
  }

  return { metrics: allMetrics, errors: [], lastSync };
}

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

router.get('/stats/dashboard', async (req: Request, res: Response) => {
  try {
    const { pageId, campaignId, dateFrom, dateTo, days: daysParam } = req.query;
    const days = parseInt(daysParam as string, 10) || 30;

    // Calculate date range
    const now = new Date();
    const currentTo = dateTo ? new Date(dateTo as string) : now;
    const currentFrom = dateFrom
      ? new Date(dateFrom as string)
      : new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    currentFrom.setHours(0, 0, 0, 0);
    if (!dateTo) { currentTo.setHours(23, 59, 59, 999); }

    const periodLength = currentTo.getTime() - currentFrom.getTime();
    const prevTo = new Date(currentFrom.getTime() - 1);
    const prevFrom = new Date(prevTo.getTime() - periodLength);

    const deltaPercent = (cur: number, prev: number) =>
      prev > 0 ? Math.round(((cur - prev) / prev) * 10000) / 100 : 0;

    // Base content filter
    const baseWhere: Record<string, unknown> = {};
    if (pageId) baseWhere.pageId = String(pageId);
    if (campaignId) baseWhere.campaignId = String(campaignId);

    // --- Fetch content items for current & previous periods ---
    const [currentItems, prevItems, allCurrentContent, allPrevContent] = await Promise.all([
      prisma.contentItem.findMany({
        where: {
          ...baseWhere,
          status: 'PUBLISHED',
          socialPostId: { not: null },
          publishedAt: { gte: currentFrom, lte: currentTo },
        },
        select: {
          id: true, socialPostId: true, topic: true, publishedAt: true,
          pageId: true, campaignId: true, generatedText: true, metrics: true,
          page: { select: { id: true, name: true, externalId: true, accessToken: true, platform: true } },
        },
      }),
      prisma.contentItem.findMany({
        where: {
          ...baseWhere,
          status: 'PUBLISHED',
          socialPostId: { not: null },
          publishedAt: { gte: prevFrom, lte: prevTo },
        },
        select: {
          id: true, socialPostId: true, topic: true, publishedAt: true,
          pageId: true, campaignId: true, metrics: true,
          page: { select: { id: true, name: true, externalId: true, accessToken: true, platform: true } },
        },
      }),
      // Pipeline: current state of ALL content (not period-scoped)
      prisma.contentItem.findMany({
        where: { ...baseWhere },
        select: { id: true, status: true, scheduledAt: true },
      }),
      // Previous period content for delta comparison
      prisma.contentItem.findMany({
        where: { ...baseWhere, createdAt: { gte: prevFrom, lte: prevTo } },
        select: { id: true, status: true },
      }),
    ]);

    // --- Read FB metrics from DB (no live FB requests on dashboard load) ---
    let fbCurrent: FbPostMetrics[] = [];
    let fbPrev: FbPostMetrics[] = [];
    const fb_errors: string[] = [];
    let fb_last_sync: string | null = null;
    try {
      const [curResult, prevResult] = await Promise.all([
        readMetricsFromDb(currentItems),
        readMetricsFromDb(prevItems),
      ]);
      fbCurrent = curResult.metrics;
      fbPrev = prevResult.metrics;
      fb_last_sync = curResult.lastSync || prevResult.lastSync;
    } catch (e) { fb_errors.push(e instanceof Error ? e.message : 'DB read failed'); }

    // --- Pipeline summary ---
    const countByStatus = (items: Array<{ status: string; scheduledAt?: Date | null }>, status: string) => {
      if (status === 'SCHEDULED') {
        return items.filter(i => i.status === 'APPROVED' && i.scheduledAt && new Date(i.scheduledAt) > now).length;
      }
      return items.filter(i => i.status === status).length;
    };
    const curPending = countByStatus(allCurrentContent, 'PENDING_REVIEW');
    const prevPending = countByStatus(allPrevContent, 'PENDING_REVIEW');
    const curGenerating = countByStatus(allCurrentContent, 'GENERATING');
    const prevGenerating = countByStatus(allPrevContent, 'GENERATING');
    const curApproved = countByStatus(allCurrentContent, 'APPROVED');
    const prevApproved = countByStatus(allPrevContent, 'APPROVED');
    const curScheduled = countByStatus(allCurrentContent, 'SCHEDULED');
    const prevScheduled = countByStatus(allPrevContent, 'SCHEDULED');
    const curPosted = countByStatus(allCurrentContent, 'PUBLISHED');
    const prevPosted = countByStatus(allPrevContent, 'PUBLISHED');
    const curFailed = countByStatus(allCurrentContent, 'FAILED');
    const prevFailed = countByStatus(allPrevContent, 'FAILED');
    // Success rate: published / (published + failed) — only content that attempted publish
    const curAttempted = curPosted + curFailed;
    const prevAttempted = prevPosted + prevFailed;
    const curRate = curAttempted > 0 ? Math.round((curPosted / curAttempted) * 10000) / 100 : 0;
    const prevRate = prevAttempted > 0 ? Math.round((prevPosted / prevAttempted) * 10000) / 100 : 0;

    const pipeline_summary = {
      pending_approval: { count: curPending, delta_percent: deltaPercent(curPending, prevPending) },
      generating: { count: curGenerating, delta_percent: deltaPercent(curGenerating, prevGenerating) },
      approved: { count: curApproved, delta_percent: deltaPercent(curApproved, prevApproved) },
      scheduled: { count: curScheduled, delta_percent: deltaPercent(curScheduled, prevScheduled) },
      posted: { count: curPosted, delta_percent: deltaPercent(curPosted, prevPosted) },
      failed: { count: curFailed, delta_percent: deltaPercent(curFailed, prevFailed) },
      success_publish_rate: { value: curRate, current: curPosted, total: curAttempted, delta_percent: deltaPercent(curRate, prevRate) },
    };

    // --- KPIs from FB metrics ---
    const sumMetric = (items: FbPostMetrics[], key: keyof FbPostMetrics) =>
      items.reduce((s, i) => s + (Number(i[key]) || 0), 0);
    const curReach = sumMetric(fbCurrent, 'reach');
    const prevReach = sumMetric(fbPrev, 'reach');
    const curReactions = sumMetric(fbCurrent, 'reactions');
    const prevReactions = sumMetric(fbPrev, 'reactions');
    const curComments = sumMetric(fbCurrent, 'comments');
    const prevComments = sumMetric(fbPrev, 'comments');
    const curShares = sumMetric(fbCurrent, 'shares');
    const prevShares = sumMetric(fbPrev, 'shares');
    const curEngagement = curReactions + curComments + curShares;
    const prevEngagement = prevReactions + prevComments + prevShares;
    // If no post has impressions data, show null instead of 0
    const hasImpressions = fbCurrent.some(m => m.reach > 0);
    const curER = curReach > 0 ? Math.round((curEngagement / curReach) * 10000) / 100 : null;
    const prevER = prevReach > 0 ? Math.round((prevEngagement / prevReach) * 10000) / 100 : null;

    const kpis = {
      total_reach: { value: hasImpressions ? curReach : null, delta_percent: hasImpressions ? deltaPercent(curReach, prevReach) : 0 },
      total_engagement: { value: curEngagement, delta_percent: deltaPercent(curEngagement, prevEngagement) },
      total_reactions: { value: curReactions, delta_percent: deltaPercent(curReactions, prevReactions) },
      total_comments: { value: curComments, delta_percent: deltaPercent(curComments, prevComments) },
      total_shares: { value: curShares, delta_percent: deltaPercent(curShares, prevShares) },
      engagement_rate: { value: curER, delta_percent: curER !== null && prevER !== null ? deltaPercent(curER, prevER) : 0 },
    };

    // --- Chart performance: group by published date ---
    const chartMap = new Map<string, { reach: number; engagement: number; posts_count: number }>();
    // Initialize all dates in range
    const d = new Date(currentFrom);
    while (d <= currentTo) {
      chartMap.set(d.toISOString().slice(0, 10), { reach: 0, engagement: 0, posts_count: 0 });
      d.setDate(d.getDate() + 1);
    }
    for (const m of fbCurrent) {
      const dateKey = m.publishedAt ? new Date(m.publishedAt).toISOString().slice(0, 10) : null;
      if (!dateKey) continue;
      const entry = chartMap.get(dateKey) ?? { reach: 0, engagement: 0, posts_count: 0 };
      entry.reach += m.reach;
      entry.engagement += m.reactions + m.comments + m.shares;
      entry.posts_count += 1;
      chartMap.set(dateKey, entry);
    }
    // Also count published items without FB metrics
    for (const item of currentItems) {
      const dateKey = item.publishedAt ? new Date(item.publishedAt).toISOString().slice(0, 10) : null;
      if (!dateKey) continue;
      if (!fbCurrent.some(f => f.contentItemId === item.id)) {
        const entry = chartMap.get(dateKey) ?? { reach: 0, engagement: 0, posts_count: 0 };
        entry.posts_count += 1;
        chartMap.set(dateKey, entry);
      }
    }
    const chart_performance = [...chartMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, v]) => ({ date, ...v }));

    // --- Top 5 content by engagement ---
    const top_contents = [...fbCurrent]
      .map(m => {
        const eng = m.reactions + m.comments + m.shares;
        return {
          id: m.contentItemId, topic: m.topic,
          excerpt: (currentItems.find(i => i.id === m.contentItemId)?.generatedText ?? '').slice(0, 120),
          pageName: m.pageName, pageExternalId: m.pageExternalId,
          publishedAt: m.publishedAt,
          reach: m.reach, engagement: eng,
          reactions: m.reactions, comments: m.comments, shares: m.shares,
          er: m.reach > 0 ? Math.round((eng / m.reach) * 10000) / 100 : 0,
        };
      })
      .sort((a, b) => b.engagement - a.engagement)
      .slice(0, 5);

    // --- Page performance ---
    const pageMap = new Map<string, { id: string; name: string; externalId: string; totalPosts: number; reach: number; engagement: number }>();
    for (const m of fbCurrent) {
      const entry = pageMap.get(m.pageId) ?? { id: m.pageId, name: m.pageName, externalId: m.pageExternalId, totalPosts: 0, reach: 0, engagement: 0 };
      entry.totalPosts += 1;
      entry.reach += m.reach;
      entry.engagement += m.reactions + m.comments + m.shares;
      pageMap.set(m.pageId, entry);
    }
    const page_performance = [...pageMap.values()].map(p => ({
      ...p,
      er: p.reach > 0 ? Math.round((p.engagement / p.reach) * 10000) / 100 : 0,
    }));

    // --- Campaign performance ---
    const campMap = new Map<string, { id: string; name: string; totalPosts: number; reach: number; engagement: number }>();
    // Need campaign names
    const campIds = [...new Set(fbCurrent.map(m => m.campaignId).filter(Boolean))];
    const campaigns = campIds.length > 0
      ? await prisma.campaign.findMany({ where: { id: { in: campIds } }, select: { id: true, name: true } })
      : [];
    const campNameMap = new Map(campaigns.map(c => [c.id, c.name]));
    for (const m of fbCurrent) {
      if (!m.campaignId) continue;
      const entry = campMap.get(m.campaignId) ?? { id: m.campaignId, name: campNameMap.get(m.campaignId) ?? '', totalPosts: 0, reach: 0, engagement: 0 };
      entry.totalPosts += 1;
      entry.reach += m.reach;
      entry.engagement += m.reactions + m.comments + m.shares;
      campMap.set(m.campaignId, entry);
    }
    const campaign_performance = [...campMap.values()].map(c => ({
      ...c,
      er: c.reach > 0 ? Math.round((c.engagement / c.reach) * 10000) / 100 : 0,
    }));

    // --- Pending items ---
    const pending_items = await prisma.contentItem.findMany({
      where: { ...baseWhere, status: { in: ['PENDING_REVIEW', 'FAILED'] } },
      select: {
        id: true, topic: true, scheduledAt: true, status: true,
        page: { select: { name: true, externalId: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    // --- Upcoming posts (next 7 days) ---
    const next7 = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const upcoming_posts = await prisma.contentItem.findMany({
      where: {
        ...baseWhere,
        scheduledAt: { gte: now, lte: next7 },
        status: { in: ['DRAFT', 'PENDING_REVIEW', 'APPROVED', 'GENERATING'] },
      },
      select: {
        id: true, topic: true, scheduledAt: true, status: true,
        page: { select: { name: true, externalId: true } },
      },
      orderBy: { scheduledAt: 'asc' },
      take: 20,
    });

    // --- Recent published ---
    const recentPublished = await prisma.contentItem.findMany({
      where: { ...baseWhere, status: 'PUBLISHED', publishedAt: { not: null } },
      select: {
        id: true, topic: true, publishedAt: true, socialPostId: true,
        pageId: true, campaignId: true, metrics: true,
        page: { select: { id: true, name: true, externalId: true, accessToken: true, platform: true } },
      },
      orderBy: { publishedAt: 'desc' },
      take: 5,
    });
    // Enrich with FB metrics from DB
    let recentFb: FbPostMetrics[] = [];
    try {
      const recentResult = await readMetricsFromDb(recentPublished);
      recentFb = recentResult.metrics;
    } catch { /* ignore */ }
    const recentFbMap = new Map(recentFb.map(m => [m.contentItemId, m]));
    const recent_posts = recentPublished.map(item => {
      const fb = recentFbMap.get(item.id);
      return {
        id: item.id, topic: item.topic,
        pageName: item.page.name, pageExternalId: item.page.externalId,
        publishedAt: item.publishedAt,
        reactions: fb?.reactions ?? 0, comments: fb?.comments ?? 0, shares: fb?.shares ?? 0,
      };
    });

    res.json({
      synced_at: fb_last_sync || null,
      fb_errors: fb_errors.length ? fb_errors : undefined,
      filters: {
        dateFrom: currentFrom.toISOString(),
        dateTo: currentTo.toISOString(),
        pageId: pageId ? String(pageId) : null,
        campaignId: campaignId ? String(campaignId) : null,
      },
      chart_performance,
      pipeline_summary,
      kpis,
      top_contents,
      page_performance,
      campaign_performance,
      pending_items: pending_items.map(i => ({
        id: i.id, topic: i.topic,
        pageName: i.page.name, pageExternalId: i.page.externalId,
        scheduledAt: i.scheduledAt, status: i.status,
      })),
      upcoming_posts: upcoming_posts.map(i => ({
        id: i.id, topic: i.topic,
        pageName: i.page.name, pageExternalId: i.page.externalId,
        scheduledAt: i.scheduledAt, status: i.status,
      })),
      recent_posts,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to fetch dashboard data' });
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

    const filtered = results.filter(c => c.totalContent > 0);
    filtered.sort((a, b) => b.published - a.published || b.totalContent - a.totalContent);
    res.json(filtered.slice(0, 7));
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
        campaignId: true,
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
        campaignId: string;
        reactions: number;
        comments: number;
        shares: number;
        reach: number;
        engagedUsers: number;
      }>;
      externalId: string;
      errors: string[];
    }> = [];

    for (const [pageId, { page, items }] of byPage) {
      const pageResult = {
        pageId,
        pageName: page.name,
        externalId: page.externalId,
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
          campaignId: string;
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
        const results = await Promise.allSettled(
          batch.map(async (postId) => {
            const url = `https://graph.facebook.com/v21.0/${postId}?fields=reactions.summary(true),comments.summary(true),shares&access_token=${encodeURIComponent(token)}`;
            const res = await fetch(url);
            const json = await res.json() as {
              reactions?: { summary?: { total_count?: number } };
              comments?: { summary?: { total_count?: number } };
              shares?: { count?: number };
              error?: { message?: string };
            };
            if (!res.ok || json.error) {
              throw new Error(json.error?.message || `HTTP ${res.status}`);
            }
            let reach = 0, engagedUsers = 0;
            try {
              const insUrl = `https://graph.facebook.com/v21.0/${postId}/insights?metric=post_impressions,post_engaged_users&access_token=${encodeURIComponent(token)}`;
              const insRes = await fetch(insUrl);
              if (insRes.ok) {
                const insJson = await insRes.json() as { data?: Array<{ name: string; values?: Array<{ value: number }> }> };
                for (const m of insJson.data ?? []) {
                  const val = m.values?.[0]?.value ?? 0;
                  if (m.name === 'post_impressions') reach = val;
                  if (m.name === 'post_engaged_users') engagedUsers = val;
                }
              }
            } catch {}
            return { postId, json, reach, engagedUsers };
          })
        );
        for (const r of results) {
          if (r.status === 'rejected') {
            pageResult.errors.push(`Post metrics: ${r.reason instanceof Error ? r.reason.message : 'Network error'}`);
            continue;
          }
          const { postId, json: postInfo, reach, engagedUsers } = r.value;
          const reactions = postInfo.reactions?.summary?.total_count ?? 0;
          const comments = postInfo.comments?.summary?.total_count ?? 0;
          const shares = postInfo.shares?.count ?? 0;
          postDataMap.set(postId, { reactions, comments, shares, reach, engagedUsers });
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
          campaignId: item.campaignId,
          ...metrics,
        });
      }

      fbCache.set(cacheKey, { data: pageResult, ts: Date.now() });
      results.push(pageResult);
    }

    const globalTotals = {
      totalReactions: results.reduce((s, p) => s + p.totalReactions, 0),
      totalComments: results.reduce((s, p) => s + p.totalComments, 0),
      totalShares: results.reduce((s, p) => s + p.totalShares, 0),
      totalReach: results.reduce((s, p) => s + p.totalReach, 0),
      totalEngagement: results.reduce((s, p) => s + p.totalReactions + p.totalComments + p.totalShares, 0),
      totalFollowers: results.reduce((s, p) => s + (p.followers || 0), 0),
      totalPosts: results.reduce((s, p) => s + p.posts.length, 0),
    };

    res.json({ pages: results, totals: globalTotals });
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

// --- FB Metrics Diagnostic: test which metrics actually return data ---
router.get('/stats/fb-metric-test', async (req: Request, res: Response) => {
  try {
    const item = await prisma.contentItem.findFirst({
      where: { status: 'PUBLISHED', socialPostId: { not: null }, page: { platform: 'FACEBOOK' } },
      include: { page: true },
      orderBy: { publishedAt: 'desc' },
    });
    if (!item || !item.socialPostId) return res.json({ error: 'No published FB post found' });

    const postId = item.socialPostId;
    const token = item.page.accessToken;
    const results: Record<string, unknown> = { postId, pageName: item.page.name, topic: item.topic };

    // Test basic engagement fields
    try {
      const url = `https://graph.facebook.com/v21.0/${postId}?fields=reactions.summary(true),comments.summary(true),shares&access_token=${encodeURIComponent(token)}`;
      const r = await fetch(url);
      results.basic = { status: r.status, data: await r.json() };
    } catch (e) { results.basic = { error: String(e) }; }

    // Test each insights metric individually
    const metricsToTest = [
      'post_impressions',
      'post_impressions_unique',
      'post_engaged_users',
      'post_clicks',
      'post_clicks_unique',
      'post_reactions_by_type_total',
    ];
    results.insights = {};
    for (const metric of metricsToTest) {
      try {
        const url = `https://graph.facebook.com/v21.0/${postId}/insights?metric=${metric}&access_token=${encodeURIComponent(token)}`;
        const r = await fetch(url);
        const json = await r.json() as Record<string, unknown>;
        (results.insights as Record<string, unknown>)[metric] = { status: r.status, data: (json.data ?? json.error ?? json) as unknown };
      } catch (e) { (results.insights as Record<string, unknown>)[metric] = { error: String(e) }; }
    }

    // Redact token from any error messages
    const sanitized = JSON.parse(JSON.stringify(results).replace(new RegExp(token.slice(0, 20), 'g'), '[REDACTED]'));
    res.json(sanitized);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Test failed' });
  }
});

// --- Manual FB Metrics Sync ---
router.post('/stats/fb-sync', async (req: Request, res: Response) => {
  try {
    const { pageId } = req.body || {};
    const where: Record<string, unknown> = {
      status: 'PUBLISHED',
      socialPostId: { not: null },
      page: { platform: 'FACEBOOK' },
    };
    if (pageId) where.pageId = String(pageId);

    const items = await prisma.contentItem.findMany({
      where,
      select: {
        id: true, socialPostId: true, topic: true, publishedAt: true,
        pageId: true, campaignId: true, metrics: true,
        page: { select: { id: true, name: true, externalId: true, accessToken: true, platform: true } },
      },
    });

    const syncErrors: string[] = [];
    let synced = 0;
    let skipped = 0;

    // Group by page
    const byPage = new Map<string, { page: typeof items[0]['page']; items: typeof items }>();
    for (const item of items) {
      if (!item.socialPostId) continue;
      const existing = byPage.get(item.pageId);
      if (existing) existing.items.push(item);
      else byPage.set(item.pageId, { page: item.page, items: [item] });
    }

    for (const [, { page, items: pageItems }] of byPage) {
      const token = page.accessToken;

      for (const item of pageItems) {
        try {
          // Fetch basic engagement
          const url = `https://graph.facebook.com/v21.0/${item.socialPostId}?fields=reactions.summary(true),comments.summary(true),shares&access_token=${encodeURIComponent(token)}`;
          const r = await fetch(url);
          const json = await r.json() as {
            reactions?: { summary?: { total_count?: number } };
            comments?: { summary?: { total_count?: number } };
            shares?: { count?: number };
            error?: { message?: string };
          };
          if (!r.ok || json.error) {
            syncErrors.push(`${page.name}/${item.topic}: ${json.error?.message || r.statusText}`);
            skipped++;
            continue;
          }

          const reactions = json.reactions?.summary?.total_count ?? 0;
          const comments = json.comments?.summary?.total_count ?? 0;
          const shares = json.shares?.count ?? 0;

          // Try insights (fail gracefully)
          let impressions: number | null = null;
          let engagedUsers: number | null = null;
          try {
            const insUrl = `https://graph.facebook.com/v21.0/${item.socialPostId}/insights?metric=post_impressions,post_engaged_users&access_token=${encodeURIComponent(token)}`;
            const insRes = await fetch(insUrl);
            if (insRes.ok) {
              const insJson = await insRes.json() as { data?: Array<{ name: string; values?: Array<{ value: number }> }> };
              for (const m of insJson.data ?? []) {
                const val = m.values?.[0]?.value;
                if (m.name === 'post_impressions' && val !== undefined) impressions = val;
                if (m.name === 'post_engaged_users' && val !== undefined) engagedUsers = val;
              }
            }
          } catch {}

          // Never overwrite existing non-zero with 0
          const existing = item.metrics as Record<string, number | string> | null;
          const metricsData: Prisma.InputJsonObject = {
            fb_reactions: reactions || existing?.fb_reactions || 0,
            fb_comments: comments || existing?.fb_comments || 0,
            fb_shares: shares || existing?.fb_shares || 0,
            fb_impressions: impressions ?? existing?.fb_impressions ?? null,
            fb_engaged_users: engagedUsers ?? existing?.fb_engaged_users ?? null,
            fb_synced_at: new Date().toISOString(),
          };

          await prisma.contentItem.update({
            where: { id: item.id },
            data: { metrics: metricsData },
          });
          synced++;
        } catch (e) {
          syncErrors.push(`${page.name}/${item.topic}: ${e instanceof Error ? e.message : 'error'}`);
          skipped++;
        }
      }
    }

    // Clear in-memory cache so dashboard picks up fresh DB data
    fbCache.clear();

    res.json({
      total: items.length,
      synced,
      skipped,
      errors: syncErrors,
      requests_made: items.length * 2,
      synced_at: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Sync failed' });
  }
});

export { router as dashboardRouter };
