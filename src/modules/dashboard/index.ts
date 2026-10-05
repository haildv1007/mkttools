import { Prisma } from '@prisma/client';
import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { prisma } from '../../utils/db';
import { listProviders, setTextProvider, setImageProvider, generateText, testConnection } from '../content-generator';
import { contentQueue, publishQueue } from '../../queues';
import { getSetting, getSettings, setSettings } from '../settings';
import { resolvePageIds } from '../workspace';
import { AuthRequest } from '../../middleware/auth';
import { OrganizationQuota, resolveSubscriptionContext } from '../organization';
import { tryResolveCredential } from '../ai-credentials';
import { getAccessContext, getAccessiblePageIds, getAccessibleWorkspaceIds, canAccessPage, intersectPageIds } from '../access';
import { logActivity, updateActivity, sanitizeError } from '../../utils/activity';
import { emitActivity, emitContentUpdate } from '../../realtime';
import { createRevisionSession, submitFeedbackAndExecute, cancelRevision, getActiveRevisionSession } from '../revision';

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

// Tenant guard: fetches contentItem, asserts org match, and (if the caller is
// a restricted member) that the caller has access to the content's page.
async function loadContentInOrg(id: string, orgId: string | undefined, req?: AuthRequest) {
  if (!orgId) return null;
  const item = await prisma.contentItem.findUnique({ where: { id } });
  if (!item || item.organizationId !== orgId) return null;
  if (req && !req.isAllAccess && req.userId) {
    const ctx = await getAccessContext(orgId, req.userId);
    if (!ctx || !(await canAccessPage(ctx, item.pageId))) return null;
  }
  return item;
}

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
  clicks: number;
  viewers: number; // fb_reach in DB = post_total_media_view_unique (unique viewers, NOT reach/impressions)
  mediaViews: number;
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
    const saved = item.metrics as { fb_reactions?: number; fb_comments?: number; fb_shares?: number; fb_clicks?: number; fb_reach?: number; fb_media_views?: number; fb_synced_at?: string } | null;
    if (saved?.fb_synced_at && (!lastSync || saved.fb_synced_at > lastSync)) {
      lastSync = saved.fb_synced_at;
    }
    allMetrics.push({
      contentItemId: item.id, socialPostId: item.socialPostId, topic: item.topic,
      publishedAt: item.publishedAt, campaignId: item.campaignId, pageId: item.pageId,
      pageName: item.page.name, pageExternalId: item.page.externalId,
      reactions: saved?.fb_reactions ?? 0,
      comments: saved?.fb_comments ?? 0,
      shares: saved?.fb_shares ?? 0,
      clicks: saved?.fb_clicks ?? 0,
      viewers: saved?.fb_reach ?? 0, // fb_reach stores post_total_media_view_unique (unique viewers)
      mediaViews: saved?.fb_media_views ?? 0,
    });
  }

  return { metrics: allMetrics, errors: [], lastSync };
}

router.get('/stats', async (req: AuthRequest, res: Response) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const orgId = req.organizationId;

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
      prisma.page.count({ where: { organizationId: orgId, isActive: true } }),
      prisma.campaign.count({ where: { organizationId: orgId, isActive: true } }),
      prisma.contentItem.count({ where: { organizationId: orgId } }),
      prisma.contentItem.groupBy({ by: ['status'], where: { organizationId: orgId }, _count: true }),
      prisma.contentItem.groupBy({ by: ['source'], where: { organizationId: orgId }, _count: true }),
      prisma.contentItem.groupBy({ by: ['contentType'], where: { organizationId: orgId }, _count: true }),
      prisma.contentItem.count({ where: { organizationId: orgId, createdAt: { gte: today, lt: tomorrow } } }),
      prisma.contentItem.count({ where: { organizationId: orgId, publishedAt: { gte: today, lt: tomorrow } } }),
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

router.get('/stats/dashboard', async (req: AuthRequest, res: Response) => {
  try {
    const { pageId, campaignId, dateFrom, dateTo, days: daysParam, scopeType, scopeId } = req.query;
    const days = parseInt(daysParam as string, 10) || 30;

    // Calculate date range in Asia/Ho_Chi_Minh (UTC+7)
    const TZ_OFFSET = '+07:00';
    const now = new Date();
    const currentFrom = dateFrom
      ? new Date(`${dateFrom as string}T00:00:00${TZ_OFFSET}`)
      : new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    const currentTo = dateTo
      ? new Date(`${dateTo as string}T23:59:59.999${TZ_OFFSET}`)
      : new Date(`${now.toLocaleString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' }).slice(0, 10)}T23:59:59.999${TZ_OFFSET}`);
    if (!dateFrom) {
      const fromStr = new Date(currentFrom.getTime()).toLocaleString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' }).slice(0, 10);
      currentFrom.setTime(new Date(`${fromStr}T00:00:00${TZ_OFFSET}`).getTime());
    }

    const periodLength = currentTo.getTime() - currentFrom.getTime();
    const prevTo = new Date(currentFrom.getTime() - 1);
    const prevFrom = new Date(prevTo.getTime() - periodLength);

    const deltaPercent = (cur: number, prev: number) =>
      prev > 0 ? Math.round(((cur - prev) / prev) * 10000) / 100 : 0;

    // Resolve scope to allowed page IDs
    const sType = String(scopeType || 'all');
    const sId = scopeId ? String(scopeId) : undefined;
    const scopePageIds = sType !== 'all' ? await resolvePageIds(sType, sId, req.organizationId!) : null;

    // Base content filter — always tenant scoped
    const baseWhere: Record<string, unknown> = { organizationId: req.organizationId };
    if (pageId) {
      // Sub-filter: validate against scope
      const pid = String(pageId);
      if (scopePageIds && !scopePageIds.includes(pid)) {
        return res.status(400).json({ error: 'Page not in current scope' });
      }
      baseWhere.pageId = pid;
    } else if (scopePageIds) {
      baseWhere.pageId = { in: scopePageIds };
    }
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
      // Pipeline: content created in current period
      prisma.contentItem.findMany({
        where: { ...baseWhere, createdAt: { gte: currentFrom, lte: currentTo } },
        select: { id: true, status: true, scheduledAt: true },
      }),
      // Previous period content for delta comparison
      prisma.contentItem.findMany({
        where: { ...baseWhere, createdAt: { gte: prevFrom, lte: prevTo } },
        select: { id: true, status: true, scheduledAt: true },
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
    const curViewers = sumMetric(fbCurrent, 'viewers');
    const prevViewers = sumMetric(fbPrev, 'viewers');
    const curMediaViews = sumMetric(fbCurrent, 'mediaViews');
    const prevMediaViews = sumMetric(fbPrev, 'mediaViews');
    const curReactions = sumMetric(fbCurrent, 'reactions');
    const prevReactions = sumMetric(fbPrev, 'reactions');
    const curComments = sumMetric(fbCurrent, 'comments');
    const prevComments = sumMetric(fbPrev, 'comments');
    const curShares = sumMetric(fbCurrent, 'shares');
    const prevShares = sumMetric(fbPrev, 'shares');
    const curClicks = sumMetric(fbCurrent, 'clicks');
    const prevClicks = sumMetric(fbPrev, 'clicks');
    const curEngagement = curReactions + curComments + curShares;
    const prevEngagement = prevReactions + prevComments + prevShares;
    const curEngViewer = curViewers > 0 ? Math.round((curEngagement / curViewers) * 10000) / 100 : null;
    const prevEngViewer = prevViewers > 0 ? Math.round((prevEngagement / prevViewers) * 10000) / 100 : null;

    const kpis = {
      total_viewers: { value: curViewers, delta_percent: deltaPercent(curViewers, prevViewers) },
      total_media_views: { value: curMediaViews, delta_percent: deltaPercent(curMediaViews, prevMediaViews) },
      total_engagement: { value: curEngagement, delta_percent: deltaPercent(curEngagement, prevEngagement) },
      total_reactions: { value: curReactions, delta_percent: deltaPercent(curReactions, prevReactions) },
      total_comments: { value: curComments, delta_percent: deltaPercent(curComments, prevComments) },
      total_shares: { value: curShares, delta_percent: deltaPercent(curShares, prevShares) },
      total_clicks: { value: curClicks, delta_percent: deltaPercent(curClicks, prevClicks) },
      eng_per_viewer: { value: curEngViewer, delta_percent: curEngViewer !== null && prevEngViewer !== null ? deltaPercent(curEngViewer, prevEngViewer) : 0 },
    };

    // --- Chart performance: group by published date (VN timezone) ---
    const toVnDate = (dt: Date) => dt.toLocaleString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' }).slice(0, 10);
    const chartMap = new Map<string, { viewers: number; media_views: number; engagement: number; posts_count: number }>();
    const d = new Date(currentFrom);
    while (d <= currentTo) {
      chartMap.set(toVnDate(d), { viewers: 0, media_views: 0, engagement: 0, posts_count: 0 });
      d.setDate(d.getDate() + 1);
    }
    for (const m of fbCurrent) {
      const dateKey = m.publishedAt ? toVnDate(new Date(m.publishedAt)) : null;
      if (!dateKey) continue;
      const entry = chartMap.get(dateKey) ?? { viewers: 0, media_views: 0, engagement: 0, posts_count: 0 };
      entry.viewers += m.viewers;
      entry.media_views += m.mediaViews;
      entry.engagement += m.reactions + m.comments + m.shares;
      entry.posts_count += 1;
      chartMap.set(dateKey, entry);
    }
    for (const item of currentItems) {
      const dateKey = item.publishedAt ? toVnDate(new Date(item.publishedAt)) : null;
      if (!dateKey) continue;
      if (!fbCurrent.some(f => f.contentItemId === item.id)) {
        const entry = chartMap.get(dateKey) ?? { viewers: 0, media_views: 0, engagement: 0, posts_count: 0 };
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
          viewers: m.viewers, mediaViews: m.mediaViews, clicks: m.clicks,
          engagement: eng, reactions: m.reactions, comments: m.comments, shares: m.shares,
          er: m.viewers > 0 ? Math.round((eng / m.viewers) * 10000) / 100 : null,
        };
      })
      .sort((a, b) => b.engagement - a.engagement)
      .slice(0, 5);

    // --- Page performance ---
    const pageMap = new Map<string, { id: string; name: string; externalId: string; totalPosts: number; viewers: number; engagement: number }>();
    for (const m of fbCurrent) {
      const entry = pageMap.get(m.pageId) ?? { id: m.pageId, name: m.pageName, externalId: m.pageExternalId, totalPosts: 0, viewers: 0, engagement: 0 };
      entry.totalPosts += 1;
      entry.viewers += m.viewers;
      entry.engagement += m.reactions + m.comments + m.shares;
      pageMap.set(m.pageId, entry);
    }
    const page_performance = [...pageMap.values()].map(p => ({
      ...p, er: p.viewers > 0 ? Math.round((p.engagement / p.viewers) * 10000) / 100 : null,
    }));

    // --- Campaign performance ---
    const campMap = new Map<string, { id: string; name: string; totalPosts: number; viewers: number; engagement: number }>();
    const campIds = [...new Set(fbCurrent.map(m => m.campaignId).filter(Boolean))];
    const campaigns = campIds.length > 0
      ? await prisma.campaign.findMany({ where: { id: { in: campIds } }, select: { id: true, name: true } })
      : [];
    const campNameMap = new Map(campaigns.map(c => [c.id, c.name]));
    for (const m of fbCurrent) {
      if (!m.campaignId) continue;
      const entry = campMap.get(m.campaignId) ?? { id: m.campaignId, name: campNameMap.get(m.campaignId) ?? '', totalPosts: 0, viewers: 0, engagement: 0 };
      entry.totalPosts += 1;
      entry.viewers += m.viewers;
      entry.engagement += m.reactions + m.comments + m.shares;
      campMap.set(m.campaignId, entry);
    }
    const campaign_performance = [...campMap.values()].map(c => ({
      ...c, er: c.viewers > 0 ? Math.round((c.engagement / c.viewers) * 10000) / 100 : null,
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
        status: { in: ['DRAFT', 'QUEUED', 'PENDING_REVIEW', 'APPROVED', 'GENERATING'] },
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

router.get('/stats/timeline', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.organizationId) return res.status(401).json({ error: 'Organization required' });
    const days = Math.max(1, Math.min(365, parseInt(req.query.days as string, 10) || 30));
    const orgId = req.organizationId;

    const rows = await prisma.$queryRaw<Array<{ date: string; created: number; published: number }>>(
      Prisma.sql`
        SELECT DATE("created_at") as date,
               COUNT(*)::int as created,
               SUM(CASE WHEN status = 'PUBLISHED' THEN 1 ELSE 0 END)::int as published
        FROM content_items
        WHERE "created_at" >= NOW() - make_interval(days => ${days})
          AND "organization_id" = ${orgId}
        GROUP BY DATE("created_at")
        ORDER BY date
      `
    );

    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to fetch timeline' });
  }
});

router.get('/stats/campaigns', async (req: AuthRequest, res: Response) => {
  try {
    const where: Record<string, unknown> = { organizationId: req.organizationId, isActive: true };
    if (!req.isAllAccess && req.userId) {
      const ctx = await getAccessContext(req.organizationId!, req.userId);
      where.pageId = { in: ctx ? await getAccessiblePageIds(ctx) : [] };
    }
    const campaigns = await prisma.campaign.findMany({
      where,
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

router.get('/stats/pages', async (req: AuthRequest, res: Response) => {
  try {
    const where: Record<string, unknown> = { organizationId: req.organizationId, isActive: true };
    if (!req.isAllAccess && req.userId) {
      const ctx = await getAccessContext(req.organizationId!, req.userId);
      where.id = { in: ctx ? await getAccessiblePageIds(ctx) : [] };
    }
    const pages = await prisma.page.findMany({
      where,
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

router.get('/stats/upcoming', async (req: AuthRequest, res: Response) => {
  try {
    const now = new Date();
    const nextWeek = new Date(now);
    nextWeek.setDate(nextWeek.getDate() + 7);

    const items = await prisma.contentItem.findMany({
      where: {
        organizationId: req.organizationId,
        scheduledAt: { gte: now, lte: nextWeek },
        status: { in: ['DRAFT', 'QUEUED', 'PENDING_REVIEW', 'APPROVED', 'GENERATING'] },
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

router.get('/stats/recent-published', async (req: AuthRequest, res: Response) => {
  try {
    const items = await prisma.contentItem.findMany({
      where: { organizationId: req.organizationId, status: 'PUBLISHED' },
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

router.get('/stats/fb-insights', async (req: AuthRequest, res: Response) => {
  try {
    // Get all published content with socialPostId (tenant scoped)
    const publishedItems = await prisma.contentItem.findMany({
      where: {
        organizationId: req.organizationId,
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
      totalClicks: number;
      totalViewers: number;
      totalMediaViews: number;
      posts: Array<{
        contentItemId: string;
        socialPostId: string;
        topic: string;
        publishedAt: Date | null;
        campaignId: string;
        reactions: number;
        comments: number;
        shares: number;
        clicks: number;
        viewers: number;
        mediaViews: number;
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
        totalClicks: 0,
        totalViewers: 0,
        totalMediaViews: 0,
        posts: [] as Array<{
          contentItemId: string;
          socialPostId: string;
          topic: string;
          publishedAt: Date | null;
          campaignId: string;
          reactions: number;
          comments: number;
          shares: number;
          clicks: number;
          viewers: number;
          mediaViews: number;
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
        reactions: number; comments: number; shares: number; clicks: number; viewers: number; mediaViews: number;
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
            let clicks = 0, reach = 0, mediaViews = 0;
            try {
              const insUrl = `https://graph.facebook.com/v21.0/${postId}/insights?metric=post_clicks,post_total_media_view_unique,post_media_view&access_token=${encodeURIComponent(token)}`;
              const insRes = await fetch(insUrl);
              if (insRes.ok) {
                const insJson = await insRes.json() as { data?: Array<{ name: string; period?: string; values?: Array<{ value: number }> }> };
                for (const m of insJson.data ?? []) {
                  if (m.period && m.period !== 'lifetime') continue;
                  const val = m.values?.[0]?.value ?? 0;
                  if (m.name === 'post_clicks') clicks = val;
                  if (m.name === 'post_total_media_view_unique') reach = val;
                  if (m.name === 'post_media_view') mediaViews = val;
                }
              }
            } catch {}
            return { postId, json, clicks, reach, mediaViews };
          })
        );
        for (const r of results) {
          if (r.status === 'rejected') {
            pageResult.errors.push(`Post metrics: ${r.reason instanceof Error ? r.reason.message : 'Network error'}`);
            continue;
          }
          const { postId, json: postInfo, clicks, reach, mediaViews } = r.value;
          const reactions = postInfo.reactions?.summary?.total_count ?? 0;
          const comments = postInfo.comments?.summary?.total_count ?? 0;
          const shares = postInfo.shares?.count ?? 0;
          postDataMap.set(postId, { reactions, comments, shares, clicks, viewers: reach, mediaViews });
        }
      }

      for (const item of items) {
        const metrics = postDataMap.get(item.socialPostId!) ?? {
          reactions: 0, comments: 0, shares: 0, clicks: 0, viewers: 0, mediaViews: 0,
        };
        pageResult.totalReactions += metrics.reactions;
        pageResult.totalComments += metrics.comments;
        pageResult.totalShares += metrics.shares;
        pageResult.totalClicks += metrics.clicks;
        pageResult.totalViewers += metrics.viewers;
        pageResult.totalMediaViews += metrics.mediaViews;
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
      totalClicks: results.reduce((s, p) => s + p.totalClicks, 0),
      totalViewers: results.reduce((s, p) => s + p.totalViewers, 0),
      totalMediaViews: results.reduce((s, p) => s + p.totalMediaViews, 0),
      totalEngagement: results.reduce((s, p) => s + p.totalReactions + p.totalComments + p.totalShares, 0),
      totalFollowers: results.reduce((s, p) => s + (p.followers || 0), 0),
      totalPosts: results.reduce((s, p) => s + p.posts.length, 0),
    };

    res.json({ pages: results, totals: globalTotals });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to fetch Facebook insights' });
  }
});

router.get('/calendar', async (req: AuthRequest, res: Response) => {
  const { from, to, pageId, scopeType, scopeId } = req.query;
  const where: Record<string, unknown> = { organizationId: req.organizationId };

  if (from && to) {
    where.scheduledAt = { gte: new Date(from as string), lte: new Date(to as string) };
  }

  const sType = String(scopeType || 'all');
  const sId = scopeId ? String(scopeId) : undefined;
  const scopePageIds = sType !== 'all' ? await resolvePageIds(sType, sId, req.organizationId!) : null;
  const accessCtx = await getAccessContext(req.organizationId!, req.userId!);
  const accessible = accessCtx && !accessCtx.isAllAccess ? await getAccessiblePageIds(accessCtx) : null;

  if (pageId) {
    const pid = String(pageId);
    if (accessible && !accessible.includes(pid)) return res.json([]);
    where.pageId = pid;
  } else if (scopePageIds) {
    where.pageId = { in: accessible ? scopePageIds.filter((p) => accessible.includes(p)) : scopePageIds };
  } else if (accessible) {
    where.pageId = { in: accessible };
  }

  const items = await prisma.contentItem.findMany({
    where,
    include: { page: true, campaign: true },
    orderBy: { scheduledAt: 'asc' },
  });

  res.json(items);
});

// Pages CRUD (tenant + access scoped)
router.get('/pages', async (req: AuthRequest, res: Response) => {
  const showAll = req.query.all === 'true';
  const where: Record<string, unknown> = { organizationId: req.organizationId, ...(showAll ? {} : { isActive: true }) };
  if (!req.isAllAccess && req.userId) {
    const ctx = await getAccessContext(req.organizationId!, req.userId);
    const ids = ctx ? await getAccessiblePageIds(ctx) : [];
    where.id = { in: ids };
  }
  const pages = await prisma.page.findMany({
    where,
    include: { _count: { select: { contentItems: true } } },
    orderBy: { createdAt: 'desc' },
  });
  const [used, limit] = await Promise.all([
    OrganizationQuota.getPageUsage(req.organizationId!),
    OrganizationQuota.getPageLimit(req.organizationId!),
  ]);
  res.setHeader('X-Page-Usage', `${used}/${limit ?? 'unlimited'}`);
  res.json(pages);
});

router.post('/pages', async (req: AuthRequest, res: Response) => {
  try {
    if (!['OWNER', 'ADMIN'].includes(req.organizationRole || '')) {
      return res.status(403).json({ error: 'FORBIDDEN', message: 'Chỉ Owner/Admin được kết nối Page.' });
    }
    // Block if subscription expired
    const subCtx = await resolveSubscriptionContext(req.organizationId!);
    if (subCtx.status === 'EXPIRED' || subCtx.status === 'NONE') {
      return res.status(402).json({ error: 'SUBSCRIPTION_EXPIRED', message: 'Thời gian dùng thử đã kết thúc. Vui lòng nâng cấp gói để tiếp tục sử dụng.' });
    }
    // Enforce quota before creation
    const check = await OrganizationQuota.canAddPage(req.organizationId!);
    if (!check.ok) {
      return res.status(400).json({
        error: 'PAGE_LIMIT_REACHED',
        message: `Bạn đã sử dụng hết ${check.limit} Page của gói hiện tại.`,
        used: check.used,
        limit: check.limit,
      });
    }
    const { platform, name, externalId, accessToken, context, metadata, telegramGroupId, isActive } = req.body || {};
    if (!platform || !name || !externalId) {
      return res.status(400).json({ error: 'platform, name, externalId required' });
    }
    // Duplicate check within org
    const dup = await prisma.page.findFirst({
      where: { organizationId: req.organizationId, platform, externalId },
    });
    if (dup) {
      if (dup.isActive) return res.status(409).json({ error: 'DUPLICATE_PAGE', message: 'Page này đã kết nối trong tổ chức.' });
      // Re-activate soft-disconnected page (recount quota with activation)
      const check2 = await OrganizationQuota.canAddPage(req.organizationId!);
      if (!check2.ok) {
        return res.status(400).json({ error: 'PAGE_LIMIT_REACHED', message: `Bạn đã sử dụng hết ${check2.limit} Page của gói hiện tại.`, used: check2.used, limit: check2.limit });
      }
      const reactivated = await prisma.page.update({
        where: { id: dup.id },
        data: { isActive: true, accessToken: accessToken || dup.accessToken, name, metadata, telegramGroupId },
      });
      return res.json(reactivated);
    }
    const page = await prisma.page.create({
      data: {
        organizationId: req.organizationId!,
        platform, name, externalId,
        accessToken: accessToken || '',
        context: context || null,
        metadata: metadata ?? undefined,
        telegramGroupId: telegramGroupId || null,
        isActive: isActive !== false,
        userId: req.body.userId || req.userId!,
      },
    });
    res.json(page);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to create page' });
  }
});

router.put('/pages/:id', async (req: AuthRequest, res: Response) => {
  const id = String(req.params.id);
  const existing = await prisma.page.findUnique({ where: { id } });
  if (!existing || existing.organizationId !== req.organizationId) return res.status(404).json({ error: 'Page not found' });
  if (!req.isAllAccess) {
    const ctx = await getAccessContext(req.organizationId!, req.userId!);
    if (!ctx || !(await canAccessPage(ctx, id))) return res.status(403).json({ error: 'RESOURCE_ACCESS_DENIED' });
  }
  // If reactivating, enforce quota
  if (existing.isActive === false && req.body?.isActive === true) {
    const check = await OrganizationQuota.canAddPage(req.organizationId!);
    if (!check.ok) return res.status(400).json({ error: 'PAGE_LIMIT_REACHED', message: `Bạn đã sử dụng hết ${check.limit} Page của gói hiện tại.` });
  }
  // Never allow client to move page across orgs
  const { organizationId: _ignore, ...safeBody } = req.body || {};
  const page = await prisma.page.update({ where: { id }, data: safeBody });
  res.json(page);
});

router.delete('/pages/:id', async (req: AuthRequest, res: Response) => {
  const id = String(req.params.id);
  const existing = await prisma.page.findUnique({ where: { id } });
  if (!existing || existing.organizationId !== req.organizationId) return res.status(404).json({ error: 'Page not found' });
  await prisma.page.update({ where: { id }, data: { isActive: false } });
  res.json({ success: true });
});

// Facebook token exchange: short-lived → long-lived → page tokens
router.post('/pages/fb-token-exchange', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.organizationId) return res.status(401).json({ error: 'Organization required' });
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

// All possible content statuses, kept in sync with the ContentStatus enum in prisma/schema.prisma
const ALL_CONTENT_STATUSES = [
  'DRAFT', 'GENERATING', 'PENDING_REVIEW', 'REVISION_REQUESTED',
  'APPROVED', 'PUBLISHING', 'PUBLISHED', 'FAILED', 'CANCELLED',
];

// Parses a comma-separated query param into a string[] (or undefined if absent/empty).
function parseCsvParam(value: unknown): string[] | undefined {
  if (!value) return undefined;
  const parts = String(value).split(',').map((v) => v.trim()).filter(Boolean);
  return parts.length ? parts : undefined;
}

// Builds a Prisma filter value for a field given optional multi/single-value query params.
// Multi-value takes precedence; falls back to single-value for backward compat.
function buildInFilter(multiValue: unknown, singleValue: unknown): string | { in: string[] } | undefined {
  const multi = parseCsvParam(multiValue);
  if (multi) return multi.length === 1 ? multi[0] : { in: multi };
  if (singleValue) return String(singleValue);
  return undefined;
}

const METRIC_OPS = new Set(['gt', 'gte', 'lt', 'lte', 'equals']);

// Parses metricFilter JSON string, e.g. {"fb_reach":{"op":"gt","val":100}}, into Prisma JSON path filters.
function parseMetricFilters(raw: unknown): Record<string, unknown>[] {
  if (!raw) return [];
  let parsed: Record<string, { op: string; val: number | string }>;
  try {
    parsed = JSON.parse(String(raw));
  } catch {
    return [];
  }
  const filters: Record<string, unknown>[] = [];
  for (const [key, cond] of Object.entries(parsed || {})) {
    if (!cond || typeof cond !== 'object') continue;
    const op = cond.op;
    if (!METRIC_OPS.has(op)) continue;
    filters.push({ metrics: { path: [key], [op]: cond.val } });
  }
  return filters;
}

// Content items — data grid API with DB-side sort/page/filter + status counts
router.get('/content', async (req: AuthRequest, res: Response) => {
  const {
    status, pageId, pageSize = '50', page: pageNum = '1', search, dateFrom, dateTo, source, campaignId, contentType,
    statuses, pageIds, sources, contentTypes, campaignIds, metricFilter,
    createdFrom, createdTo, publishedFrom, publishedTo,
    scopeType, scopeId, sortBy = 'scheduledAt', sortDir = 'desc',
  } = req.query;

  // Build base where (without status, so we can count per-status) — always tenant scoped
  const baseWhere: Record<string, unknown> = { organizationId: req.organizationId };

  const accessCtx = await getAccessContext(req.organizationId!, req.userId!);
  // Restricted members: intersect every query with accessible page ids up front.
  const accessible = accessCtx && !accessCtx.isAllAccess ? await getAccessiblePageIds(accessCtx) : null;

  const sType = String(scopeType || 'all');
  const sId = scopeId ? String(scopeId) : undefined;
  const scopePageIdsRaw = sType !== 'all' ? await resolvePageIds(sType, sId, req.organizationId!) : null;
  const scopePageIds = scopePageIdsRaw && accessible ? scopePageIdsRaw.filter((p) => accessible.includes(p)) : scopePageIdsRaw;

  const pageIdFilter = buildInFilter(pageIds, pageId);
  if (pageIdFilter !== undefined) {
    const requested = typeof pageIdFilter === 'string' ? [pageIdFilter] : pageIdFilter.in;
    let allowed = requested;
    if (scopePageIds) allowed = allowed.filter((pid) => scopePageIds.includes(pid));
    if (accessible) allowed = allowed.filter((pid) => accessible.includes(pid));
    if (!allowed.length) {
      return res.json({ items: [], total: 0, statusCounts: {} });
    }
    baseWhere.pageId = allowed.length === 1 ? allowed[0] : { in: allowed };
  } else if (scopePageIds) {
    baseWhere.pageId = { in: scopePageIds };
  } else if (accessible) {
    baseWhere.pageId = { in: accessible };
  }

  const sourceFilter = buildInFilter(sources, source);
  if (sourceFilter !== undefined) baseWhere.source = sourceFilter;

  const campaignIdFilter = buildInFilter(campaignIds, campaignId);
  if (campaignIdFilter !== undefined) baseWhere.campaignId = campaignIdFilter;

  const contentTypeFilter = buildInFilter(contentTypes, contentType);
  if (contentTypeFilter !== undefined) baseWhere.contentType = contentTypeFilter;

  if (search) baseWhere.topic = { contains: String(search), mode: 'insensitive' };
  if (dateFrom || dateTo) {
    const dateFilter: Record<string, Date> = {};
    if (dateFrom) dateFilter.gte = new Date(String(dateFrom));
    if (dateTo) {
      const end = new Date(String(dateTo));
      end.setHours(23, 59, 59, 999);
      dateFilter.lte = end;
    }
    baseWhere.scheduledAt = dateFilter;
  }
  if (createdFrom || createdTo) {
    const df: Record<string, Date> = {};
    if (createdFrom) df.gte = new Date(String(createdFrom));
    if (createdTo) { const e = new Date(String(createdTo)); e.setHours(23, 59, 59, 999); df.lte = e; }
    baseWhere.createdAt = df;
  }
  if (publishedFrom || publishedTo) {
    const df: Record<string, Date> = {};
    if (publishedFrom) df.gte = new Date(String(publishedFrom));
    if (publishedTo) { const e = new Date(String(publishedTo)); e.setHours(23, 59, 59, 999); df.lte = e; }
    baseWhere.publishedAt = df;
  }

  const metricFilters = parseMetricFilters(metricFilter);
  if (metricFilters.length) {
    const existingAnd = Array.isArray(baseWhere.AND) ? baseWhere.AND : [];
    baseWhere.AND = [...existingAnd, ...metricFilters];
  }

  // Status filter applied only to items query
  const where: Record<string, any> = { ...baseWhere };
  let statusFilter = buildInFilter(statuses, status);
  // Include REVISION_REQUESTED when filtering by PENDING_REVIEW
  if (statusFilter === 'PENDING_REVIEW') {
    statusFilter = { in: ['PENDING_REVIEW', 'REVISION_REQUESTED'] };
  } else if (statusFilter && typeof statusFilter === 'object' && statusFilter.in && statusFilter.in.includes('PENDING_REVIEW')) {
    if (!statusFilter.in.includes('REVISION_REQUESTED')) statusFilter.in.push('REVISION_REQUESTED');
  }
  if (statusFilter !== undefined) where.status = statusFilter;

  // Sorting
  const allowedSorts: Record<string, string> = {
    scheduledAt: 'scheduledAt', createdAt: 'createdAt', publishedAt: 'publishedAt',
    topic: 'topic', status: 'status', contentType: 'contentType', source: 'source',
  };
  const sortField = allowedSorts[String(sortBy)] || 'scheduledAt';
  const sortDirection = String(sortDir) === 'asc' ? 'asc' as const : 'desc' as const;

  const take = Math.min(Math.max(1, Number(pageSize)), 200);
  const skip = (Math.max(1, Number(pageNum)) - 1) * take;

  const [items, total, statusGroups, metricsRows] = await Promise.all([
    prisma.contentItem.findMany({
      where,
      include: {
        page: { select: { id: true, name: true, platform: true, externalId: true } },
        campaign: { select: { id: true, name: true } },
      },
      orderBy: { [sortField]: sortDirection },
      take,
      skip,
    }),
    prisma.contentItem.count({ where }),
    prisma.contentItem.groupBy({ by: ['status'], where: baseWhere, _count: true }),
    prisma.contentItem.findMany({ where, select: { metrics: true } }),
  ]);

  const statusCounts: Record<string, number> = {};
  let allCount = 0;
  for (const s of ALL_CONTENT_STATUSES) statusCounts[s] = 0;
  for (const g of statusGroups) {
    statusCounts[g.status] = g._count;
    allCount += g._count;
  }
  statusCounts.ALL = allCount;

  // Aggregate metrics summary across entire filtered dataset
  let metricItemCount = 0;
  let viewersSum = 0, viewsSum = 0, reactionsSum = 0, commentsSum = 0, sharesSum = 0, clicksSum = 0;
  for (const row of metricsRows) {
    const m = row.metrics as Record<string, number> | null;
    if (!m || m.fb_reach == null) continue;
    metricItemCount++;
    viewersSum += Number(m.fb_reach) || 0;
    viewsSum += Number(m.fb_media_views) || 0;
    reactionsSum += Number(m.fb_reactions) || 0;
    commentsSum += Number(m.fb_comments) || 0;
    sharesSum += Number(m.fb_shares) || 0;
    clicksSum += Number(m.fb_clicks) || 0;
  }
  const engagementSum = reactionsSum + commentsSum + sharesSum;
  const engViewer = viewersSum > 0 ? Math.round((engagementSum / viewersSum) * 10000) / 100 : null;

  const summary = {
    resultCount: total,
    metricItemCount,
    viewersSum: metricItemCount ? viewersSum : null,
    viewsSum: metricItemCount ? viewsSum : null,
    engagementSum: metricItemCount ? engagementSum : null,
    reactionsSum: metricItemCount ? reactionsSum : null,
    commentsSum: metricItemCount ? commentsSum : null,
    sharesSum: metricItemCount ? sharesSum : null,
    clicksSum: metricItemCount ? clicksSum : null,
    engViewer,
  };

  res.json({ items, total, statusCounts, summary, page: Math.floor(skip / take) + 1, pageSize: take });
});

// Campaigns filtered by a set of page IDs — used for the cascading Page → Campaign filter
router.get('/content/campaigns-for-pages', async (req: AuthRequest, res: Response) => {
  const pageIds = parseCsvParam(req.query.pageIds);
  if (!pageIds || !pageIds.length) {
    return res.json([]);
  }
  const campaigns = await prisma.campaign.findMany({
    where: { organizationId: (req as AuthRequest).organizationId, pageId: { in: pageIds } },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });
  res.json(campaigns);
});

router.post('/content/generate-all-drafts', async (req: AuthRequest, res: Response) => {
  const subCtx = await resolveSubscriptionContext(req.organizationId!);
  if (subCtx.status === 'EXPIRED' || subCtx.status === 'NONE') {
    return res.status(402).json({ error: 'SUBSCRIPTION_EXPIRED', message: 'Thời gian dùng thử đã kết thúc. Vui lòng nâng cấp gói để tiếp tục sử dụng.' });
  }
  const drafts = await prisma.contentItem.findMany({
    where: { organizationId: req.organizationId, status: 'DRAFT' },
    take: 50,
  });

  for (const item of drafts) {
    await prisma.contentItem.update({ where: { id: item.id }, data: { status: 'QUEUED' } });
    await contentQueue.add('generate', { contentItemId: item.id }, {
      jobId: `gen-${item.id}-${Date.now()}`,
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
    });
  }

  res.json({ success: true, queued: drafts.length, message: `Queued ${drafts.length} drafts for generation` });
});

router.post('/content/:id/regenerate', async (req: AuthRequest, res: Response) => {
  const subCtx = await resolveSubscriptionContext(req.organizationId!);
  if (subCtx.status === 'EXPIRED' || subCtx.status === 'NONE') {
    return res.status(402).json({ error: 'SUBSCRIPTION_EXPIRED', message: 'Thời gian dùng thử đã kết thúc. Vui lòng nâng cấp gói để tiếp tục sử dụng.' });
  }
  const id = req.params.id as string;
  const owned = await loadContentInOrg(id, req.organizationId, req);
  if (!owned) return res.status(404).json({ error: 'Content not found' });
  await prisma.contentItem.update({ where: { id }, data: { status: 'QUEUED' } });
  await contentQueue.add('generate', { contentItemId: id, organizationId: req.organizationId, actorUserId: req.userId }, {
    jobId: `regen-${id}-${Date.now()}`,
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
  });
  res.json({ success: true, message: 'Queued for regeneration' });
});

router.post('/content/:id/publish-now', async (req: AuthRequest, res: Response) => {
  const subCtx = await resolveSubscriptionContext(req.organizationId!);
  if (subCtx.status === 'EXPIRED' || subCtx.status === 'NONE') {
    return res.status(402).json({ error: 'SUBSCRIPTION_EXPIRED', message: 'Thời gian dùng thử đã kết thúc. Vui lòng nâng cấp gói để tiếp tục sử dụng.' });
  }
  const id = req.params.id as string;
  const owned = await loadContentInOrg(id, req.organizationId, req);
  if (!owned) return res.status(404).json({ success: false, error: 'Not found' });
  const item = await prisma.contentItem.findUnique({ where: { id }, select: { generatedText: true, status: true } });
  if (!item) return res.status(404).json({ success: false, error: 'Not found' });
  if (!item.generatedText) {
    await prisma.contentItem.update({ where: { id }, data: { status: 'QUEUED' } });
    await contentQueue.add('generate', { contentItemId: id, organizationId: req.organizationId, actorUserId: req.userId }, {
      jobId: `regen-${id}-${Date.now()}`,
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
    });
    return res.json({ success: true, message: 'Chưa có nội dung, đã đưa vào hàng đợi gen lại' });
  }
  await publishQueue.add('publish', { contentItemId: id, organizationId: req.organizationId, actorUserId: req.userId }, {
    jobId: `pub-now-${id}-${Date.now()}`,
  });
  res.json({ success: true, message: 'Queued for publishing' });
});

// Single content item detail — used by the drawer (tenant scoped)
router.get('/content/:id', async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const item = await prisma.contentItem.findUnique({
      where: { id },
      include: {
        page: { select: { id: true, name: true, platform: true, externalId: true, organizationId: true } },
        campaign: { select: { id: true, name: true } },
        approvalLogs: {
          include: { user: { select: { id: true, name: true } } },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!item || item.organizationId !== req.organizationId) return res.status(404).json({ error: 'Content not found' });
    if (!req.isAllAccess && req.userId) {
      const ctx = await getAccessContext(req.organizationId!, req.userId);
      if (!ctx || !(await canAccessPage(ctx, item.pageId))) return res.status(404).json({ error: 'Content not found' });
    }
    res.json(item);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to load content' });
  }
});

// Sync metrics for a single published content item
router.post('/content/:id/sync-metrics', async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const item = await prisma.contentItem.findUnique({
      where: { id },
      include: { page: { select: { accessToken: true, platform: true, externalId: true } } },
    });
    if (!item || item.organizationId !== req.organizationId) return res.status(404).json({ error: 'Content not found' });
    if (!item.socialPostId) return res.status(400).json({ error: 'No social post ID' });
    if (item.page.platform !== 'FACEBOOK') return res.status(400).json({ error: 'Only Facebook supported' });

    const token = item.page.accessToken;
    const url = `https://graph.facebook.com/v21.0/${item.socialPostId}?fields=reactions.summary(true),comments.summary(true),shares&access_token=${encodeURIComponent(token)}`;
    const r = await fetch(url);
    const json = await r.json() as { reactions?: { summary?: { total_count?: number } }; comments?: { summary?: { total_count?: number } }; shares?: { count?: number }; error?: { message?: string } };
    if (!r.ok || json.error) return res.status(400).json({ error: json.error?.message || 'Facebook API error' });

    const reactions = json.reactions?.summary?.total_count ?? 0;
    const comments = json.comments?.summary?.total_count ?? 0;
    const shares = json.shares?.count ?? 0;

    let clicks: number | null = null;
    let reach: number | null = null;
    let mediaViews: number | null = null;
    try {
      const insUrl = `https://graph.facebook.com/v21.0/${item.socialPostId}/insights?metric=post_clicks,post_total_media_view_unique,post_media_view&access_token=${encodeURIComponent(token)}`;
      const insRes = await fetch(insUrl);
      if (insRes.ok) {
        const insJson = await insRes.json() as { data?: Array<{ name: string; period?: string; values?: Array<{ value: number }> }> };
        for (const m of insJson.data ?? []) {
          if (m.period && m.period !== 'lifetime') continue;
          const val = m.values?.[0]?.value;
          if (m.name === 'post_clicks' && val !== undefined) clicks = val;
          if (m.name === 'post_total_media_view_unique' && val !== undefined) reach = val;
          if (m.name === 'post_media_view' && val !== undefined) mediaViews = val;
        }
      }
    } catch {}

    const existing = item.metrics as Record<string, number | string> | null;
    const metricsData: Prisma.InputJsonObject = {
      fb_reactions: reactions, fb_comments: comments, fb_shares: shares,
      fb_clicks: clicks !== null ? clicks : (existing?.fb_clicks ?? 0),
      fb_reach: reach !== null ? reach : (existing?.fb_reach ?? 0),
      fb_media_views: mediaViews !== null ? mediaViews : (existing?.fb_media_views ?? 0),
      fb_synced_at: new Date().toISOString(),
    };

    const updated = await prisma.contentItem.update({
      where: { id },
      data: { metrics: metricsData },
      include: {
        page: { select: { id: true, name: true, platform: true, externalId: true } },
        campaign: { select: { id: true, name: true } },
      },
    });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Sync failed' });
  }
});

router.delete('/content/:id', async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const owned = await loadContentInOrg(id, req.organizationId, req);
    if (!owned) return res.status(404).json({ error: 'Content not found' });
    await prisma.approvalLog.deleteMany({ where: { contentItemId: id } });
    await prisma.contentItem.delete({ where: { id } });
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to delete' });
  }
});

// ===== BULK ACTIONS =====

router.post('/content/bulk/generate', async (req: AuthRequest, res: Response) => {
  try {
    const { ids } = req.body as { ids: string[] };
    if (!ids?.length) return res.status(400).json({ error: 'No ids' });
    const actId = await logActivity({ action: 'bulk_generate', category: 'bulk', summary: `Gen hàng loạt ${ids.length} mục`, total: ids.length, organizationId: req.organizationId });
    const items = await prisma.contentItem.findMany({ where: { id: { in: ids }, organizationId: req.organizationId }, select: { id: true, status: true } });
    const eligible = items.filter(i => ['DRAFT', 'FAILED', 'PENDING_REVIEW', 'REVISION_REQUESTED', 'APPROVED'].includes(i.status));
    const skipped = items.length - eligible.length;
    let success = 0, errors = 0;
    for (const item of eligible) {
      try {
        await prisma.contentItem.update({ where: { id: item.id }, data: { status: 'QUEUED' } });
        await contentQueue.add('generate', { contentItemId: item.id, organizationId: req.organizationId, actorUserId: req.userId }, {
          jobId: `bulk-gen-${item.id}-${Date.now()}`,
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
        });
        success++;
      } catch { errors++; }
    }
    const notFound = ids.length - items.length;
    await updateActivity(actId, { status: errors > 0 ? 'error' : 'success', summary: `Gen hàng loạt: ${success} thành công, ${skipped + notFound} bỏ qua`, progress: success, total: ids.length });
    res.json({ success: true, total: ids.length, generated: success, skipped: skipped + notFound, errors });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Bulk generate failed' });
  }
});

router.post('/content/bulk/approve', async (req: AuthRequest, res: Response) => {
  try {
    const { ids, userId } = req.body as { ids: string[]; userId?: string };
    if (!ids?.length) return res.status(400).json({ error: 'No ids' });
    const actId = await logActivity({ action: 'bulk_approve', category: 'bulk', summary: `Duyệt hàng loạt ${ids.length} mục`, total: ids.length, organizationId: req.organizationId });
    const items = await prisma.contentItem.findMany({ where: { id: { in: ids }, organizationId: req.organizationId }, select: { id: true, status: true } });
    const eligible = items.filter(i => i.status === 'PENDING_REVIEW');
    const skipped = items.length - eligible.length;
    let success = 0, errors = 0;
    for (const item of eligible) {
      try {
        await prisma.contentItem.update({ where: { id: item.id }, data: { status: 'APPROVED' } });
        await prisma.approvalLog.create({ data: { contentItemId: item.id, userId: userId || 'system', action: 'APPROVE' } });
        success++;
      } catch { errors++; }
    }
    const notFound = ids.length - items.length;
    const finalSummary = `Duyệt hàng loạt: ${success} thành công, ${skipped + notFound} bỏ qua`;
    await updateActivity(actId, { status: errors > 0 ? 'error' : 'success', summary: finalSummary, progress: success, total: ids.length });
    emitActivity({ id: actId, action: 'bulk_approve', category: 'bulk', status: errors > 0 ? 'error' : 'success', summary: finalSummary, progress: success, total: ids.length, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    for (const item of eligible) {
      emitContentUpdate({ contentId: item.id, pageId: '', operation: 'approve', status: 'completed', contentStatus: 'APPROVED', updatedAt: new Date().toISOString(), version: Date.now() });
    }
    res.json({ success: true, total: ids.length, approved: success, skipped: skipped + notFound, errors });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Bulk approve failed' });
  }
});

router.post('/content/bulk/publish', async (req: AuthRequest, res: Response) => {
  try {
    const { ids } = req.body as { ids: string[] };
    if (!ids?.length) return res.status(400).json({ error: 'No ids' });
    const actId = await logActivity({ action: 'bulk_publish', category: 'bulk', summary: `Đăng hàng loạt ${ids.length} mục`, total: ids.length, organizationId: req.organizationId });
    const items = await prisma.contentItem.findMany({
      where: { id: { in: ids }, organizationId: req.organizationId },
      select: { id: true, status: true, generatedText: true, pageId: true },
    });
    const eligible = items.filter(i => ['APPROVED', 'FAILED'].includes(i.status) && i.generatedText);
    const skipped = items.length - eligible.length;
    let success = 0, errors = 0;
    for (const item of eligible) {
      try {
        await publishQueue.add('publish', { contentItemId: item.id, organizationId: req.organizationId, actorUserId: req.userId }, {
          jobId: `bulk-pub-${item.id}-${Date.now()}`,
        });
        success++;
      } catch { errors++; }
    }
    const notFound = ids.length - items.length;
    await updateActivity(actId, { status: errors > 0 ? 'error' : 'success', summary: `Đăng hàng loạt: ${success} đưa vào hàng đợi, ${skipped + notFound} bỏ qua`, progress: success, total: ids.length });
    res.json({ success: true, total: ids.length, published: success, skipped: skipped + notFound, errors });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Bulk publish failed' });
  }
});

router.post('/content/bulk/delete', async (req: AuthRequest, res: Response) => {
  try {
    const { ids } = req.body as { ids: string[] };
    if (!ids?.length) return res.status(400).json({ error: 'No ids' });
    const actId = await logActivity({ action: 'bulk_delete', category: 'bulk', summary: `Xóa hàng loạt ${ids.length} mục`, total: ids.length, organizationId: req.organizationId });
    const items = await prisma.contentItem.findMany({ where: { id: { in: ids }, organizationId: req.organizationId }, select: { id: true, status: true } });
    const eligible = items.filter(i => !['PUBLISHING'].includes(i.status));
    const skipped = items.length - eligible.length;
    let success = 0, errors = 0;
    for (const item of eligible) {
      try {
        await prisma.approvalLog.deleteMany({ where: { contentItemId: item.id } });
        await prisma.contentItem.delete({ where: { id: item.id } });
        success++;
      } catch { errors++; }
    }
    const notFound = ids.length - items.length;
    const delSummary = `Xóa hàng loạt: ${success} đã xóa, ${skipped + notFound} bỏ qua`;
    await updateActivity(actId, { status: errors > 0 ? 'error' : 'success', summary: delSummary, progress: success, total: ids.length });
    emitActivity({ id: actId, action: 'bulk_delete', category: 'bulk', status: errors > 0 ? 'error' : 'success', summary: delSummary, progress: success, total: ids.length, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    res.json({ success: true, total: ids.length, deleted: success, skipped: skipped + notFound, errors });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Bulk delete failed' });
  }
});

router.patch('/content/:id', async (req: AuthRequest, res: Response) => {
  const id = req.params.id as string;
  const owned = await loadContentInOrg(id, req.organizationId, req);
  if (!owned) return res.status(404).json({ error: 'Content not found' });
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

router.post('/content', async (req: AuthRequest, res: Response) => {
  try {
    const { pageId, topic, contentType, scheduledAt, notes, imageDescriptions, campaignId, generatedText, imageUrl, videoUrl, imageUrls } = req.body;
    if (!pageId || !topic || !scheduledAt) {
      return res.status(400).json({ error: 'Thiếu thông tin: pageId, topic, scheduledAt là bắt buộc' });
    }
    // Assert page belongs to tenant
    const page = await prisma.page.findUnique({ where: { id: pageId }, select: { organizationId: true } });
    if (!page || page.organizationId !== req.organizationId) return res.status(404).json({ error: 'Page not found' });
    let cId = campaignId;
    if (!cId) {
      let defaultCampaign = await prisma.campaign.findFirst({ where: { organizationId: req.organizationId, name: 'Thủ công', pageId: req.body.pageId, isActive: true } });
      if (!defaultCampaign) {
        defaultCampaign = await prisma.campaign.create({
          data: { organizationId: req.organizationId!, name: 'Thủ công', description: 'Content tạo thủ công', pageId: req.body.pageId, startDate: new Date(), userId: req.body.userId || req.userId || 'system' },
        });
      }
      cId = defaultCampaign.id;
    } else {
      const camp = await prisma.campaign.findUnique({ where: { id: cId }, select: { organizationId: true } });
      if (!camp || camp.organizationId !== req.organizationId) return res.status(404).json({ error: 'Campaign not found' });
    }
    const hasContent = !!(generatedText || imageUrl || videoUrl);
    const item = await prisma.contentItem.create({
      data: {
        organizationId: req.organizationId!,
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
router.post('/content/:id/approve', async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const owned = await loadContentInOrg(id, req.organizationId, req);
    if (!owned) return res.status(404).json({ error: 'Content not found' });
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

router.post('/content/:id/reject', async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const owned = await loadContentInOrg(id, req.organizationId, req);
    if (!owned) return res.status(404).json({ error: 'Content not found' });
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

router.post('/content/:id/request-edit', async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const owned = await loadContentInOrg(id, req.organizationId, req);
    if (!owned) return res.status(404).json({ error: 'Content not found' });
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
router.post('/content/:id/upload-image', imageUpload.single('image'), async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const owned = await loadContentInOrg(id, req.organizationId, req);
    if (!owned) return res.status(404).json({ error: 'Content not found' });
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

router.post('/content/:id/upload-images', imageUpload.array('images', 10), async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const owned = await loadContentInOrg(id, req.organizationId, req);
    if (!owned) return res.status(404).json({ error: 'Content not found' });
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

router.post('/content/:id/upload-video', videoUpload.single('video'), async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const owned = await loadContentInOrg(id, req.organizationId, req);
    if (!owned) return res.status(404).json({ error: 'Content not found' });
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

router.delete('/content/:id/video', async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const owned = await loadContentInOrg(id, req.organizationId, req);
    if (!owned) return res.status(404).json({ error: 'Content not found' });
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
router.post('/test-generate', async (req: AuthRequest, res: Response) => {
  try {
    const { topic, pageName, contentType } = req.body;
    const result = await generateText({
      topic: topic || 'Khuyến mãi cuối tuần',
      pageName: pageName || 'Test Page',
      contentType: contentType || 'post',
      credential: { organizationId: req.organizationId!, actorUserId: req.userId },
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

// Gemini image models — recommended catalog + best-effort live listing from
// the organization's OWN credential. Model list is always returned even when
// the org has no (or an invalid) Gemini credential; credential health is a
// separate signal (`credentialConfigured`) so the dropdown never goes blank.
router.get('/gemini-image-models', async (req: AuthRequest, res: Response) => {
  const knownModels = [
    { id: 'gemini-3.1-flash-image', name: 'Nano Banana 2', description: 'Mới nhất, hỗ trợ 4K, chỉnh sửa ảnh (2026)' },
    { id: 'gemini-3.1-flash-lite-image', name: 'Nano Banana 2 Lite', description: 'Nhanh nhất, tiết kiệm chi phí (2026)' },
    { id: 'imagen-4', name: 'Imagen 4', description: 'Google Imagen — chất lượng cao' },
  ];
  const cred = await tryResolveCredential({ organizationId: req.organizationId!, provider: 'gemini' });
  if (!cred?.apiKey) {
    return res.json({ models: knownModels, credentialConfigured: false });
  }
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${cred.apiKey}`);
    const data = await r.json() as { models?: Array<{ name: string; displayName: string; description: string; supportedGenerationMethods: string[] }> };
    const apiModels = (data.models || [])
      .filter(m => m.name.includes('image') || m.description?.toLowerCase().includes('image'))
      .map(m => ({ id: m.name.replace('models/', ''), name: m.displayName, description: m.description }));
    const apiIds = new Set(apiModels.map(m => m.id));
    const merged = [...knownModels.filter(m => !apiIds.has(m.id)), ...apiModels];
    res.json({ models: merged, credentialConfigured: true });
  } catch {
    // Live listing failed — still return the known catalog so an already
    // configured model never disappears from the dropdown.
    res.json({ models: knownModels, credentialConfigured: true });
  }
});

router.post('/test-image-model', async (req: AuthRequest, res: Response) => {
  try {
    const { model } = req.body;
    if (!model) return res.status(400).json({ error: 'Chưa chọn model' });
    const cred = await tryResolveCredential({ organizationId: req.organizationId!, provider: 'gemini' });
    const apiKey = cred?.apiKey;
    if (!apiKey) return res.status(400).json({ error: 'Chưa cấu hình Gemini cho tổ chức' });

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

// OpenAI image models — same contract as gemini-image-models: the catalog is
// always returned; `credentialConfigured` tells the UI whether the org can
// actually use it yet.
router.get('/openai-image-models', async (req: AuthRequest, res: Response) => {
  const models = [
    { id: 'gpt-image-2.5-sunburst', name: 'GPT Image 2.5 Sunburst', description: '#1 — editing chính xác, chi tiết sắc nét (9/2026)' },
    { id: 'gpt-image-2.5-flare', name: 'GPT Image 2.5 Flare', description: 'Nhanh, chất lượng cao, dùng hàng ngày (9/2026)' },
    { id: 'gpt-image-2', name: 'GPT Image 2', description: 'Chất lượng rất cao (2026)' },
    { id: 'gpt-image-1', name: 'GPT Image 1', description: 'Chất lượng tốt (2025)' },
    { id: 'dall-e-3', name: 'DALL-E 3', description: 'Text in images, ổn định' },
  ];
  const cred = await tryResolveCredential({ organizationId: req.organizationId!, provider: 'openai' });
  res.json({ models, credentialConfigured: !!cred?.apiKey });
});

router.post('/test-openai-image-model', async (req: AuthRequest, res: Response) => {
  try {
    const { model } = req.body;
    if (!model) return res.status(400).json({ error: 'Chưa chọn model' });
    const cred = await tryResolveCredential({ organizationId: req.organizationId!, provider: 'openai' });
    const apiKey = cred?.apiKey;
    if (!apiKey) return res.status(400).json({ error: 'Chưa cấu hình OpenAI cho tổ chức' });

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

router.post('/test-connection', async (req: AuthRequest, res: Response) => {
  try {
    const { type } = req.body;
    if (!['text', 'image'].includes(type)) {
      return res.status(400).json({ ok: false, error: 'Type phải là text hoặc image' });
    }
    const result = await testConnection(type, req.organizationId);
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

// --- FB Metrics Diagnostic V2: comprehensive test ---
router.get('/stats/fb-metric-test', async (req: Request, res: Response) => {
  try {
    // Get up to 3 published posts for testing
    const posts = await prisma.contentItem.findMany({
      where: { status: 'PUBLISHED', socialPostId: { not: null }, page: { platform: 'FACEBOOK' } },
      include: { page: true },
      orderBy: { publishedAt: 'desc' },
      take: 3,
    });
    if (!posts.length) return res.json({ error: 'No published FB post found' });

    const page = posts[0].page;
    const token = page.accessToken;
    const pageExternalId = page.externalId;

    // Helper to test a single insights metric on a post
    async function testInsight(postId: string, metric: string) {
      try {
        const url = `https://graph.facebook.com/v21.0/${postId}/insights?metric=${metric}&access_token=${encodeURIComponent(token)}`;
        const r = await fetch(url);
        const json = await r.json() as Record<string, unknown>;
        return { status: r.status, data: (json.data ?? json.error ?? json) as unknown };
      } catch (e) { return { status: 0, error: String(e) }; }
    }

    // Helper to test page-level metric
    async function testPageInsight(metric: string, period: string) {
      try {
        const url = `https://graph.facebook.com/v21.0/${pageExternalId}/insights?metric=${metric}&period=${period}&access_token=${encodeURIComponent(token)}`;
        const r = await fetch(url);
        const json = await r.json() as Record<string, unknown>;
        return { status: r.status, period, data: (json.data ?? json.error ?? json) as unknown };
      } catch (e) { return { status: 0, error: String(e) }; }
    }

    const results: Record<string, unknown> = {
      tested_posts: posts.map(p => ({
        postId: p.socialPostId, topic: p.topic, publishedAt: p.publishedAt, contentType: p.contentType,
      })),
      pageName: page.name,
      pageExternalId,
    };

    // === P0 DISTRIBUTION ===
    const p0dist: Record<string, unknown> = {};
    for (const post of posts) {
      const pid = post.socialPostId!;
      const postResults: Record<string, unknown> = {};
      postResults.post_total_media_view_unique = await testInsight(pid, 'post_total_media_view_unique');
      postResults.post_media_view = await testInsight(pid, 'post_media_view');
      p0dist[pid] = { topic: post.topic, metrics: postResults };
    }
    results.p0_distribution = p0dist;

    // Test breakdown for post_media_view if supported
    const firstPostId = posts[0].socialPostId!;
    const breakdownTests: Record<string, unknown> = {};
    for (const breakdown of ['is_from_ads', 'is_from_followers']) {
      try {
        const url = `https://graph.facebook.com/v21.0/${firstPostId}/insights?metric=post_media_view&breakdown=${breakdown}&access_token=${encodeURIComponent(token)}`;
        const r = await fetch(url);
        const json = await r.json() as Record<string, unknown>;
        breakdownTests[breakdown] = { status: r.status, data: (json.data ?? json.error ?? json) as unknown };
      } catch (e) { breakdownTests[breakdown] = { status: 0, error: String(e) }; }
    }
    results.p0_media_view_breakdowns = breakdownTests;

    // === P0 ENGAGEMENT ===
    const p0eng: Record<string, unknown> = {};
    // Basic fields
    try {
      const url = `https://graph.facebook.com/v21.0/${firstPostId}?fields=reactions.summary(true),comments.summary(true),shares&access_token=${encodeURIComponent(token)}`;
      const r = await fetch(url);
      p0eng.basic_engagement = { status: r.status, data: await r.json() };
    } catch (e) { p0eng.basic_engagement = { error: String(e) }; }
    p0eng.post_clicks = await testInsight(firstPostId, 'post_clicks');
    p0eng.post_clicks_by_type = await testInsight(firstPostId, 'post_clicks_by_type');
    results.p0_engagement = p0eng;

    // === P1 REACTION BREAKDOWN ===
    const p1react: Record<string, unknown> = {};
    // Find a post with reactions
    const postWithReactions = posts.find(p => {
      const m = p.metrics as Record<string, number> | null;
      return m && (m.fb_reactions > 0);
    }) || posts[0];
    const reactPostId = postWithReactions.socialPostId!;
    const reactionMetrics = [
      'post_reactions_by_type_total',
      'post_reactions_like_total',
      'post_reactions_love_total',
      'post_reactions_wow_total',
      'post_reactions_haha_total',
      'post_reactions_sorry_total',
      'post_reactions_anger_total',
    ];
    for (const metric of reactionMetrics) {
      p1react[metric] = await testInsight(reactPostId, metric);
    }
    results.p1_reaction_breakdown = { postId: reactPostId, topic: postWithReactions.topic, metrics: p1react };

    // === P1 PAGE LEVEL ===
    const p1page: Record<string, unknown> = {};
    for (const period of ['day', 'week', 'days_28']) {
      p1page[`page_total_media_view_unique_${period}`] = await testPageInsight('page_total_media_view_unique', period);
      p1page[`page_media_view_${period}`] = await testPageInsight('page_media_view', period);
    }
    results.p1_page_level = p1page;

    // === P2 VIDEO METRICS ===
    const videoPost = posts.find(p => p.contentType === 'VIDEO');
    if (videoPost) {
      const vPostId = videoPost.socialPostId!;
      const p2video: Record<string, unknown> = { postId: vPostId, topic: videoPost.topic };
      const videoMetrics = [
        'post_video_avg_time_watched',
        'post_video_view_time',
        'post_video_views',
        'post_video_views_unique',
        'post_video_view_time_by_region_id',
      ];
      for (const metric of videoMetrics) {
        p2video[metric] = await testInsight(vPostId, metric);
      }
      results.p2_video = p2video;
    } else {
      results.p2_video = { skipped: 'No video post found among recent published items' };
    }

    // Redact token
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

          // Fetch insights: clicks + reach + media views
          let clicks: number | null = null;
          let reach: number | null = null;
          let mediaViews: number | null = null;
          try {
            const insUrl = `https://graph.facebook.com/v21.0/${item.socialPostId}/insights?metric=post_clicks,post_total_media_view_unique,post_media_view&access_token=${encodeURIComponent(token)}`;
            const insRes = await fetch(insUrl);
            if (insRes.ok) {
              const insJson = await insRes.json() as { data?: Array<{ name: string; period?: string; values?: Array<{ value: number }> }> };
              for (const m of insJson.data ?? []) {
                if (m.period && m.period !== 'lifetime') continue;
                const val = m.values?.[0]?.value;
                if (m.name === 'post_clicks' && val !== undefined) clicks = val;
                if (m.name === 'post_total_media_view_unique' && val !== undefined) reach = val;
                if (m.name === 'post_media_view' && val !== undefined) mediaViews = val;
              }
            }
          } catch {}

          // Persist API values directly; null means insights call failed → keep existing
          const existing = item.metrics as Record<string, number | string> | null;
          const metricsData: Prisma.InputJsonObject = {
            fb_reactions: reactions,
            fb_comments: comments,
            fb_shares: shares,
            fb_clicks: clicks !== null ? clicks : (existing?.fb_clicks ?? 0),
            fb_reach: reach !== null ? reach : (existing?.fb_reach ?? 0),
            fb_media_views: mediaViews !== null ? mediaViews : (existing?.fb_media_views ?? 0),
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

// ===== ACTIVITY FEED =====

const ACTIVITY_WHITELIST_FIELDS = ['id', 'action', 'category', 'status', 'summary', 'detail', 'entityType', 'entityLabel', 'progress', 'total', 'errorCode', 'createdAt', 'updatedAt'] as const;

router.get('/activity', async (req: AuthRequest, res: Response) => {
  try {
    const { category, limit: limitParam, cursor } = req.query;
    const take = Math.min(Math.max(1, Number(limitParam) || 30), 100);

    const where: Record<string, unknown> = { organizationId: req.organizationId };
    // Restricted members: only see activity tied to content they can access.
    if (!req.isAllAccess && req.userId) {
      const ctx = await getAccessContext(req.organizationId!, req.userId);
      const pageIds = ctx ? await getAccessiblePageIds(ctx) : [];
      const accessibleContent = pageIds.length
        ? await prisma.contentItem.findMany({
            where: { organizationId: req.organizationId, pageId: { in: pageIds } },
            select: { id: true },
          })
        : [];
      where.entityType = 'content';
      where.entityId = { in: accessibleContent.map((c) => c.id) };
    }
    if (category && category !== 'all') where.category = String(category);
    if (cursor) where.createdAt = { lt: new Date(String(cursor)) };

    const logs = await prisma.activityLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: take + 1,
    });

    const hasMore = logs.length > take;
    const items = logs.slice(0, take).map(log => {
      const safe: Record<string, unknown> = {};
      for (const f of ACTIVITY_WHITELIST_FIELDS) {
        safe[f] = (log as Record<string, unknown>)[f];
      }
      return safe;
    });

    res.json({
      items,
      hasMore,
      nextCursor: hasMore && items.length > 0 ? (items[items.length - 1].createdAt as Date).toISOString() : null,
    });
  } catch (err) {
    res.status(500).json({ error: 'Không thể tải nhật ký hoạt động' });
  }
});

router.get('/content/active', async (req: AuthRequest, res: Response) => {
  try {
    const where: Record<string, unknown> = { organizationId: req.organizationId, status: { in: ['QUEUED', 'GENERATING', 'PUBLISHING'] } };
    if (!req.isAllAccess && req.userId) {
      const ctx = await getAccessContext(req.organizationId!, req.userId);
      where.pageId = { in: ctx ? await getAccessiblePageIds(ctx) : [] };
    }
    const items = await prisma.contentItem.findMany({
      where,
      select: {
        id: true,
        topic: true,
        status: true,
        pageId: true,
        campaignId: true,
        updatedAt: true,
        page: { select: { name: true, externalId: true, platform: true } },
        campaign: { select: { name: true } },
      },
      take: 100,
      orderBy: { updatedAt: 'desc' },
    });
    res.json(items.map(i => ({
      contentId: i.id,
      pageId: i.pageId,
      campaignId: i.campaignId,
      operation: i.status === 'PUBLISHING' ? 'publish' : 'generate',
      status: i.status === 'QUEUED' ? 'queued' : 'started',
      step: i.status === 'QUEUED' ? 'Chờ đến lượt' : i.status === 'GENERATING' ? 'Đang gen nội dung' : 'Đang đăng bài',
      contentTitle: i.topic?.slice(0, 100),
      pageName: i.page?.name,
      pageAvatar: i.page?.platform === 'FACEBOOK' && i.page?.externalId ? `https://graph.facebook.com/${i.page.externalId}/picture?type=small` : undefined,
      campaignName: i.campaign?.name,
      contentStatus: i.status,
      startedAt: i.updatedAt.toISOString(),
      updatedAt: i.updatedAt.toISOString(),
      version: i.updatedAt.getTime(),
    })));
  } catch {
    res.json([]);
  }
});

// ── Revision V2 endpoints ──

router.post('/content/:id/revision', async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const owned = await loadContentInOrg(id, req.organizationId, req);
    if (!owned) return res.status(404).json({ error: 'Content not found' });
    const { revisionType, selectedMediaIds, feedbackText, userId } = req.body;
    if (!revisionType) return res.status(400).json({ error: 'revisionType required' });

    const session = await createRevisionSession({
      contentItemId: id,
      revisionType,
      selectedMediaIds,
      source: 'WEB',
      userId: userId || 'system',
    });

    if (feedbackText) {
      submitFeedbackAndExecute({
        sessionId: session.id,
        feedbackText,
        userId: userId || 'system',
      }).catch(err => console.error('Revision execute error:', err));
    }

    res.json({ sessionId: session.id, status: session.status });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Revision failed' });
  }
});

router.get('/content/:id/revisions', async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const owned = await loadContentInOrg(id, req.organizationId, req);
    if (!owned) return res.status(404).json({ error: 'Content not found' });
    const revisions = await prisma.contentRevision.findMany({
      where: { contentItemId: id },
      orderBy: { version: 'asc' },
    });
    res.json(revisions);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to load revisions' });
  }
});

router.post('/revision/:id/feedback', async (req: Request, res: Response) => {
  try {
    const sessionId = req.params.id as string;
    const { feedbackText, userId } = req.body;
    if (!feedbackText) return res.status(400).json({ error: 'feedbackText required' });

    await submitFeedbackAndExecute({
      sessionId,
      feedbackText,
      userId: userId || 'system',
    });

    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Feedback failed' });
  }
});

router.post('/revision/:id/cancel', async (req: Request, res: Response) => {
  try {
    const result = await cancelRevision(req.params.id as string);
    res.json({ success: !!result });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Cancel failed' });
  }
});

export { router as dashboardRouter };
