import { prisma } from '../../utils/db';
import { publishToFacebook } from './providers/facebook';
import type { PublishResult } from '../../types';

export async function publishContent(contentItemId: string): Promise<PublishResult> {
  const item = await prisma.contentItem.findUnique({
    where: { id: contentItemId },
    include: { page: true },
  });

  if (!item) return { success: false, error: 'Content item not found' };
  if (item.status !== 'APPROVED') return { success: false, error: `Invalid status: ${item.status}` };
  if (!item.generatedText) return { success: false, error: 'No generated text' };

  await prisma.contentItem.update({
    where: { id: contentItemId },
    data: { status: 'PUBLISHING' },
  });

  let result: PublishResult;

  switch (item.page.platform) {
    case 'FACEBOOK':
      result = await publishToFacebook({
        pageId: item.page.externalId,
        accessToken: item.page.accessToken,
        message: item.generatedText,
        imageUrl: item.generatedImageUrl || undefined,
      });
      break;

    case 'TIKTOK':
      result = { success: false, error: 'TikTok publishing not yet implemented' };
      break;

    default:
      result = { success: false, error: `Unknown platform: ${item.page.platform}` };
  }

  await prisma.contentItem.update({
    where: { id: contentItemId },
    data: {
      status: result.success ? 'PUBLISHED' : 'FAILED',
      socialPostId: result.postId || null,
      publishedAt: result.success ? new Date() : null,
      errorMessage: result.error || null,
      retryCount: result.success ? item.retryCount : item.retryCount + 1,
    },
  });

  return result;
}
