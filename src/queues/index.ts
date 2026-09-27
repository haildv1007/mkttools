import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { prisma } from '../utils/db';
import { config } from '../config';
import { logger } from '../utils/logger';
import { generateText, generateImage } from '../modules/content-generator';
import { sendContentForApproval } from '../modules/telegram-bot';
import { publishContent } from '../modules/publisher';
import { extractCleanText } from '../utils/clean-text';

const connection = new IORedis(config.redis.url, { maxRetriesPerRequest: null });

export const contentQueue = new Queue('content-generation', { connection });
export const publishQueue = new Queue('content-publishing', { connection });
export const scheduleQueue = new Queue('content-scheduler', { connection });

export function startWorkers() {
  const contentWorker = new Worker('content-generation', async (job) => {
    const { contentItemId } = job.data;

    const item = await prisma.contentItem.findUnique({
      where: { id: contentItemId },
      include: { page: true },
    });
    if (!item) throw new Error(`Content item ${contentItemId} not found`);

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

    await prisma.contentItem.update({
      where: { id: contentItemId },
      data: {
        generatedText: fullText,
        generatedImageUrl: imageUrl,
        generatedImages: generatedImages ? JSON.parse(JSON.stringify(generatedImages)) : undefined,
        status: 'PENDING_REVIEW',
        aiModel: config.ai.text.provider,
        aiImageModel: imageUrl ? config.ai.image.provider : null,
      },
    });

    await sendContentForApproval({
      contentItemId,
      pageInfo: `${item.page.name} (${item.page.platform})`,
      scheduledAt: item.scheduledAt.toISOString(),
      generatedText: fullText,
      imageUrl: imageUrl || undefined,
    });

    return { contentItemId, status: 'pending_review' };
  }, { connection, concurrency: 3 });

  const publishWorker = new Worker('content-publishing', async (job) => {
    const { contentItemId } = job.data;
    return publishContent(contentItemId);
  }, { connection, concurrency: 5 });

  const schedulerWorker = new Worker('content-scheduler', async () => {
    const now = new Date();
    const ahead = new Date(now.getTime() + 30 * 60 * 1000);

    const draftItems = await prisma.contentItem.findMany({
      where: {
        status: 'DRAFT',
        scheduledAt: { lte: ahead },
      },
      take: 20,
    });

    for (const item of draftItems) {
      await contentQueue.add('generate', { contentItemId: item.id }, {
        jobId: `gen-${item.id}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      });
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

    return { generated: draftItems.length, published: approvedItems.length };
  }, { connection });

  contentWorker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'Content generation failed');
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
