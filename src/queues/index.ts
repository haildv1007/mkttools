import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { prisma } from '../utils/db';
import { config } from '../config';
import { logger } from '../utils/logger';
import { generateText, generateImage } from '../modules/content-generator';
import { sendContentForApproval } from '../modules/telegram-bot';
import { publishContent } from '../modules/publisher';
import { extractCleanText } from '../utils/clean-text';
import { logActivity, updateActivity, sanitizeError } from '../utils/activity';
import { emitContentUpdate, emitActivity } from '../realtime';

const connection = new IORedis(config.redis.url, { maxRetriesPerRequest: null });

export const contentQueue = new Queue('content-generation', { connection });
export const publishQueue = new Queue('content-publishing', { connection });
export const scheduleQueue = new Queue('content-scheduler', { connection });

function nowISO() { return new Date().toISOString(); }
let _ver = Date.now();
function nextVer() { return ++_ver; }

function emitActFromLog(id: string, opts: any, status?: string) {
  emitActivity({
    id,
    action: opts.action,
    category: opts.category,
    status: status || opts.status || 'running',
    summary: opts.summary?.slice(0, 500) || '',
    detail: opts.detail,
    entityType: opts.entityType,
    entityId: opts.entityId,
    entityLabel: opts.entityLabel,
    progress: opts.progress,
    total: opts.total,
    errorCode: opts.errorCode,
    createdAt: nowISO(),
    updatedAt: nowISO(),
  });
}

export function startWorkers() {
  const contentWorker = new Worker('content-generation', async (job) => {
    const { contentItemId } = job.data;

    const item = await prisma.contentItem.findUnique({
      where: { id: contentItemId },
      include: { page: true, campaign: true },
    });
    if (!item) throw new Error(`Content item ${contentItemId} not found`);

    const actOpts = { action: 'generate', category: 'content' as const, summary: `Đang gen nội dung: ${item.topic.slice(0, 80)}`, entityType: 'content', entityId: contentItemId, entityLabel: item.topic.slice(0, 100) };
    const actId = await logActivity(actOpts);
    emitActFromLog(actId, actOpts);

    await prisma.contentItem.update({
      where: { id: contentItemId },
      data: { status: 'GENERATING' },
    });

    emitContentUpdate({
      contentId: contentItemId,
      pageId: item.pageId,
      campaignId: item.campaignId || undefined,
      operation: 'generate',
      status: 'started',
      step: 'Đang tạo nội dung',
      contentTitle: item.topic.slice(0, 100),
      pageName: item.page.name,
      pageAvatar: item.page.platform === 'FACEBOOK' ? `https://graph.facebook.com/${item.page.externalId}/picture?type=small` : undefined,
      campaignName: item.campaign?.name,
      contentStatus: 'GENERATING',
      startedAt: nowISO(),
      updatedAt: nowISO(),
      version: nextVer(),
    });

    const textResult = await generateText({
      topic: item.topic,
      pageName: item.page.name,
      pageContext: item.page.context || undefined,
      contentType: item.contentType,
      notes: item.notes || undefined,
    });

    let fullText = textResult.text +
      (textResult.hashtags.length ? '\n\n' + textResult.hashtags.map(h => `#${h}`).join(' ') : '') +
      (textResult.cta ? '\n\n' + textResult.cta : '');
    fullText = extractCleanText(fullText);

    emitContentUpdate({
      contentId: contentItemId,
      pageId: item.pageId,
      campaignId: item.campaignId || undefined,
      operation: 'generate',
      status: 'progress',
      step: 'Đang tạo ảnh',
      contentTitle: item.topic.slice(0, 100),
      pageName: item.page.name,
      contentStatus: 'GENERATING',
      updatedAt: nowISO(),
      version: nextVer(),
    });

    let imageUrl: string | null = null;
    let generatedImages: Array<{url: string; localPath?: string; description?: string}> | null = null;

    if (item.contentType === 'IMAGE' || item.contentType === 'VIDEO') {
      const descriptions = item.imageDescriptions
        ? item.imageDescriptions.split('|').map(d => d.trim()).filter(Boolean)
        : [];

      if (descriptions.length > 1) {
        generatedImages = [];
        for (let i = 0; i < descriptions.length; i++) {
          const desc = descriptions[i];
          try {
            const imgResult = await generateImage({ prompt: desc });
            generatedImages.push({ url: imgResult.url, localPath: imgResult.localPath, description: desc });
            emitContentUpdate({
              contentId: contentItemId,
              pageId: item.pageId,
              operation: 'generate',
              status: 'progress',
              step: 'Đang tạo ảnh',
              progressCurrent: i + 1,
              progressTotal: descriptions.length,
              contentTitle: item.topic.slice(0, 100),
              pageName: item.page.name,
              contentStatus: 'GENERATING',
              updatedAt: nowISO(),
              version: nextVer(),
            });
          } catch (err) {
            console.error(`Image generation failed for description "${desc}":`, err);
          }
        }
        if (generatedImages.length > 0) {
          imageUrl = generatedImages[0].url;
        }
      } else {
        try {
          const prompt = descriptions[0] || `Social media post image for: ${item.topic}. Style: professional marketing, vibrant colors.`;
          const imageResult = await generateImage({ prompt });
          imageUrl = imageResult.url;
        } catch (err) {
          console.error(`Image generation failed for ${contentItemId}:`, err);
        }
      }
    }

    const shouldAutoApprove = item.campaign?.autoApprove === true;
    const finalStatus = shouldAutoApprove ? 'APPROVED' : 'PENDING_REVIEW';

    await prisma.contentItem.update({
      where: { id: contentItemId },
      data: {
        generatedText: fullText,
        generatedImageUrl: imageUrl,
        generatedImages: generatedImages ? JSON.parse(JSON.stringify(generatedImages)) : undefined,
        status: finalStatus,
        aiModel: config.ai.text.provider,
        aiImageModel: imageUrl ? config.ai.image.provider : null,
      },
    });

    emitContentUpdate({
      contentId: contentItemId,
      pageId: item.pageId,
      campaignId: item.campaignId || undefined,
      operation: 'generate',
      status: 'completed',
      contentTitle: item.topic.slice(0, 100),
      pageName: item.page.name,
      campaignName: item.campaign?.name,
      thumbnailUrl: imageUrl || undefined,
      contentStatus: finalStatus,
      safeMessage: shouldAutoApprove ? 'Gen xong, tự duyệt' : 'Gen xong, chờ duyệt',
      updatedAt: nowISO(),
      version: nextVer(),
    });

    if (!shouldAutoApprove) {
      await sendContentForApproval({
        contentItemId,
        pageInfo: `${item.page.name} (${item.page.platform})`,
        scheduledAt: item.scheduledAt.toISOString(),
        generatedText: fullText,
        imageUrl: imageUrl || undefined,
      });
    }

    const actSummary = `Gen xong: ${item.topic.slice(0, 80)}` + (shouldAutoApprove ? ' (tự duyệt)' : '');
    await updateActivity(actId, { status: 'success', summary: actSummary });
    emitActFromLog(actId, { ...actOpts, summary: actSummary }, 'success');

    return { contentItemId, status: shouldAutoApprove ? 'auto_approved' : 'pending_review' };
  }, { connection, concurrency: 10 });

  const publishWorker = new Worker('content-publishing', async (job) => {
    const { contentItemId } = job.data;
    const ci = await prisma.contentItem.findUnique({
      where: { id: contentItemId },
      select: { topic: true, pageId: true, campaignId: true, page: { select: { name: true, externalId: true, platform: true } }, campaign: { select: { name: true } } },
    });
    const label = ci?.topic?.slice(0, 80) || contentItemId;
    const actOpts = { action: 'publish', category: 'publish' as const, summary: `Đang đăng bài: ${label}`, entityType: 'content', entityId: contentItemId, entityLabel: label };
    const actId = await logActivity(actOpts);
    emitActFromLog(actId, actOpts);

    if (ci) {
      emitContentUpdate({
        contentId: contentItemId,
        pageId: ci.pageId,
        campaignId: ci.campaignId || undefined,
        operation: 'publish',
        status: 'started',
        step: 'Đang đăng bài',
        contentTitle: label,
        pageName: ci.page?.name,
        pageAvatar: ci.page?.platform === 'FACEBOOK' ? `https://graph.facebook.com/${ci.page?.externalId}/picture?type=small` : undefined,
        campaignName: ci.campaign?.name,
        contentStatus: 'PUBLISHING',
        startedAt: nowISO(),
        updatedAt: nowISO(),
        version: nextVer(),
      });
    }

    const result = await publishContent(contentItemId);
    if (!result.success) {
      const safe = sanitizeError(result.error);
      await updateActivity(actId, { status: 'error', summary: `Đăng thất bại: ${label}`, detail: safe.message, errorCode: safe.code });
      emitActFromLog(actId, { ...actOpts, summary: `Đăng thất bại: ${label}`, detail: safe.message, errorCode: safe.code }, 'error');
      if (ci) {
        emitContentUpdate({
          contentId: contentItemId,
          pageId: ci.pageId,
          operation: 'publish',
          status: 'failed',
          contentTitle: label,
          pageName: ci.page?.name,
          contentStatus: 'FAILED',
          safeMessage: safe.message,
          updatedAt: nowISO(),
          version: nextVer(),
        });
      }
      logger.error({ contentItemId, error: result.error }, 'Publish failed');
      throw new Error(result.error || 'Publish failed');
    }
    await updateActivity(actId, { status: 'success', summary: `Đã đăng: ${label}` });
    emitActFromLog(actId, { ...actOpts, summary: `Đã đăng: ${label}` }, 'success');
    if (ci) {
      emitContentUpdate({
        contentId: contentItemId,
        pageId: ci.pageId,
        campaignId: ci.campaignId || undefined,
        operation: 'publish',
        status: 'completed',
        contentTitle: label,
        pageName: ci.page?.name,
        contentStatus: 'PUBLISHED',
        safeMessage: 'Đã đăng thành công',
        updatedAt: nowISO(),
        version: nextVer(),
      });
    }
    return result;
  }, { connection, concurrency: 15 });

  const schedulerWorker = new Worker('content-scheduler', async () => {
    const now = new Date();
    const actOpts = { action: 'scheduler', category: 'system' as const, summary: 'Scheduler đang quét nội dung...' };
    const actId = await logActivity(actOpts);
    emitActFromLog(actId, actOpts);

    let generatedCount = 0;
    let cursor: string | undefined;
    while (true) {
      const draftItems = await prisma.contentItem.findMany({
        where: { status: 'DRAFT' },
        include: { campaign: { select: { genLeadTime: true } } },
        orderBy: { scheduledAt: 'asc' },
        take: 500,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      });
      if (draftItems.length === 0) break;
      cursor = draftItems[draftItems.length - 1].id;

      let allFuture = true;
      for (const item of draftItems) {
        const leadMinutes = item.campaign?.genLeadTime ?? 30;
        const ahead = new Date(now.getTime() + leadMinutes * 60 * 1000);
        if (item.scheduledAt > ahead) continue;
        allFuture = false;

        await contentQueue.add('generate', { contentItemId: item.id }, {
          jobId: `gen-${item.id}-${Date.now()}`,
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
        });
        generatedCount++;
      }
      if (allFuture) break;
    }

    let publishedCount = 0;
    let pubCursor: string | undefined;
    while (true) {
      const approvedItems = await prisma.contentItem.findMany({
        where: {
          status: 'APPROVED',
          scheduledAt: { lte: now },
        },
        take: 200,
        ...(pubCursor ? { skip: 1, cursor: { id: pubCursor } } : {}),
      });
      if (approvedItems.length === 0) break;
      pubCursor = approvedItems[approvedItems.length - 1].id;

      for (const item of approvedItems) {
        await publishQueue.add('publish', { contentItemId: item.id }, {
          jobId: `pub-${item.id}-${Date.now()}`,
          attempts: 3,
          backoff: { type: 'exponential', delay: 10000 },
        });
        publishedCount++;
      }
    }

    const summary = `Scheduler xong: ${generatedCount} gen, ${publishedCount} publish`;
    await updateActivity(actId, { status: 'success', summary });
    emitActFromLog(actId, { ...actOpts, summary }, 'success');
    logger.info({ generated: generatedCount, published: publishedCount }, 'Scheduler cycle done');
    return { generated: generatedCount, published: publishedCount };
  }, { connection });

  contentWorker.on('failed', async (job, err) => {
    logger.error({ jobId: job?.id, err }, 'Content generation failed');
    if (job?.data?.contentItemId) {
      const safe = sanitizeError(err);
      const cid = job.data.contentItemId;
      const ci = await prisma.contentItem.findUnique({ where: { id: cid }, select: { pageId: true, topic: true, page: { select: { name: true } } } }).catch(() => null);

      await prisma.contentItem.update({
        where: { id: cid },
        data: { status: 'FAILED', errorMessage: err?.message || 'Generation failed' },
      }).catch(() => {});

      const actId = await logActivity({ action: 'generate', category: 'content', status: 'error', summary: `Gen thất bại: ${cid.slice(0, 20)}`, detail: safe.message, errorCode: safe.code, entityType: 'content', entityId: cid });
      emitActFromLog(actId, { action: 'generate', category: 'content', summary: `Gen thất bại: ${cid.slice(0, 20)}`, detail: safe.message, errorCode: safe.code, entityType: 'content', entityId: cid }, 'error');

      if (ci) {
        emitContentUpdate({
          contentId: cid,
          pageId: ci.pageId,
          operation: 'generate',
          status: 'failed',
          contentTitle: ci.topic?.slice(0, 100),
          pageName: ci.page?.name,
          contentStatus: 'FAILED',
          safeMessage: safe.message,
          updatedAt: nowISO(),
          version: nextVer(),
        });
      }
    }
  });

  publishWorker.on('failed', async (job, err) => {
    logger.error({ jobId: job?.id, err }, 'Publishing failed');
    if (job?.data?.contentItemId) {
      const safe = sanitizeError(err);
      const cid = job.data.contentItemId;
      const ci = await prisma.contentItem.findUnique({ where: { id: cid }, select: { pageId: true, topic: true, page: { select: { name: true } } } }).catch(() => null);
      if (ci) {
        emitContentUpdate({
          contentId: cid,
          pageId: ci.pageId,
          operation: 'publish',
          status: 'failed',
          contentTitle: ci.topic?.slice(0, 100),
          pageName: ci.page?.name,
          contentStatus: 'FAILED',
          safeMessage: safe.message,
          updatedAt: nowISO(),
          version: nextVer(),
        });
      }
    }
  });

  logger.info('Queue workers started');
  return { contentWorker, publishWorker, schedulerWorker };
}

export async function startScheduler() {
  await scheduleQueue.upsertJobScheduler('check-schedule', {
    every: 60000,
  }, {
    name: 'check-schedule',
  });
  logger.info('Scheduler running (every 60s)');
}
