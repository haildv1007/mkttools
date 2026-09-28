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

const connection = new IORedis(config.redis.url, { maxRetriesPerRequest: null });

export const contentQueue = new Queue('content-generation', { connection });
export const publishQueue = new Queue('content-publishing', { connection });
export const scheduleQueue = new Queue('content-scheduler', { connection });

export function startWorkers() {
  const contentWorker = new Worker('content-generation', async (job) => {
    const { contentItemId } = job.data;

    const item = await prisma.contentItem.findUnique({
      where: { id: contentItemId },
      include: { page: true, campaign: true },
    });
    if (!item) throw new Error(`Content item ${contentItemId} not found`);

    const actId = await logActivity({ action: 'generate', category: 'content', summary: `Đang gen nội dung: ${item.topic.slice(0, 80)}`, entityType: 'content', entityId: contentItemId, entityLabel: item.topic.slice(0, 100) });

    await prisma.contentItem.update({
      where: { id: contentItemId },
      data: { status: 'GENERATING' },
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

    let imageUrl: string | null = null;
    let generatedImages: Array<{url: string; localPath?: string; description?: string}> | null = null;

    if (item.contentType === 'IMAGE' || item.contentType === 'VIDEO') {
      const descriptions = item.imageDescriptions
        ? item.imageDescriptions.split('|').map(d => d.trim()).filter(Boolean)
        : [];

      if (descriptions.length > 1) {
        generatedImages = [];
        for (const desc of descriptions) {
          try {
            const imgResult = await generateImage({
              prompt: desc,
            });
            generatedImages.push({ url: imgResult.url, localPath: imgResult.localPath, description: desc });
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

    await prisma.contentItem.update({
      where: { id: contentItemId },
      data: {
        generatedText: fullText,
        generatedImageUrl: imageUrl,
        generatedImages: generatedImages ? JSON.parse(JSON.stringify(generatedImages)) : undefined,
        status: shouldAutoApprove ? 'APPROVED' : 'PENDING_REVIEW',
        aiModel: config.ai.text.provider,
        aiImageModel: imageUrl ? config.ai.image.provider : null,
      },
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

    await updateActivity(actId, { status: 'success', summary: `Gen xong: ${item.topic.slice(0, 80)}` + (shouldAutoApprove ? ' (tự duyệt)' : '') });

    return { contentItemId, status: shouldAutoApprove ? 'auto_approved' : 'pending_review' };
  }, { connection, concurrency: 3 });

  const publishWorker = new Worker('content-publishing', async (job) => {
    const { contentItemId } = job.data;
    const ci = await prisma.contentItem.findUnique({ where: { id: contentItemId }, select: { topic: true } });
    const label = ci?.topic?.slice(0, 80) || contentItemId;
    const actId = await logActivity({ action: 'publish', category: 'publish', summary: `Đang đăng bài: ${label}`, entityType: 'content', entityId: contentItemId, entityLabel: label });
    const result = await publishContent(contentItemId);
    if (!result.success) {
      const safe = sanitizeError(result.error);
      await updateActivity(actId, { status: 'error', summary: `Đăng thất bại: ${label}`, detail: safe.message, errorCode: safe.code });
      logger.error({ contentItemId, error: result.error }, 'Publish failed');
      throw new Error(result.error || 'Publish failed');
    }
    await updateActivity(actId, { status: 'success', summary: `Đã đăng: ${label}` });
    return result;
  }, { connection, concurrency: 5 });

  const schedulerWorker = new Worker('content-scheduler', async () => {
    const now = new Date();

    const draftItems = await prisma.contentItem.findMany({
      where: { status: 'DRAFT' },
      include: { campaign: { select: { genLeadTime: true } } },
      take: 50,
    });

    let generatedCount = 0;
    for (const item of draftItems) {
      const leadMinutes = item.campaign?.genLeadTime ?? 30;
      const ahead = new Date(now.getTime() + leadMinutes * 60 * 1000);
      if (item.scheduledAt > ahead) continue;

      await contentQueue.add('generate', { contentItemId: item.id }, {
        jobId: `gen-${item.id}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      });
      generatedCount++;
    }

    const approvedItems = await prisma.contentItem.findMany({
      where: {
        status: 'APPROVED',
        scheduledAt: { lte: now },
      },
      take: 20,
    });

    for (const item of approvedItems) {
      await publishQueue.add('publish', { contentItemId: item.id }, {
        jobId: `pub-${item.id}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 10000 },
      });
    }

    return { generated: generatedCount, published: approvedItems.length };
  }, { connection });

  contentWorker.on('failed', async (job, err) => {
    logger.error({ jobId: job?.id, err }, 'Content generation failed');
    if (job?.data?.contentItemId) {
      const safe = sanitizeError(err);
      await prisma.contentItem.update({
        where: { id: job.data.contentItemId },
        data: {
          status: 'FAILED',
          errorMessage: err?.message || 'Generation failed',
        },
      }).catch(() => {});
      await logActivity({ action: 'generate', category: 'content', status: 'error', summary: `Gen thất bại: ${job.data.contentItemId.slice(0, 20)}`, detail: safe.message, errorCode: safe.code, entityType: 'content', entityId: job.data.contentItemId });
    }
  });

  publishWorker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'Publishing failed');
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
