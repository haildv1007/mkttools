import { Queue, Worker, QueueEvents } from 'bullmq';
import IORedis from 'ioredis';
import { PrismaClient } from '@prisma/client';
import { config } from '../config';
import { generateText, generateImage } from '../modules/content-generator';
import { sendContentForApproval } from '../modules/telegram-bot';
import { publishContent } from '../modules/publisher';

const prisma = new PrismaClient();

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
      contentType: item.contentType,
      notes: item.notes || undefined,
    });

    const fullText = textResult.text +
      (textResult.hashtags.length ? '\n\n' + textResult.hashtags.map(h => `#${h}`).join(' ') : '') +
      (textResult.cta ? '\n\n' + textResult.cta : '');

    let imageUrl: string | null = null;
    if (item.contentType === 'IMAGE' || item.contentType === 'VIDEO') {
      try {
        const imageResult = await generateImage({
          prompt: `Social media post image for: ${item.topic}. Style: professional marketing, vibrant colors.`,
        });
        imageUrl = imageResult.url;
      } catch (err) {
        console.error(`Image generation failed for ${contentItemId}:`, err);
      }
    }

    await prisma.contentItem.update({
      where: { id: contentItemId },
      data: {
        generatedText: fullText,
        generatedImageUrl: imageUrl,
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
    console.error(`Content generation failed [${job?.id}]:`, err.message);
  });

  publishWorker.on('failed', (job, err) => {
    console.error(`Publishing failed [${job?.id}]:`, err.message);
  });

  console.log('Queue workers started');
  return { contentWorker, publishWorker, schedulerWorker };
}

export async function startScheduler() {
  await scheduleQueue.upsertJobScheduler('check-schedule', {
    every: 60000,
  }, {
    name: 'check-schedule',
  });
  console.log('Scheduler running (every 60s)');
}
