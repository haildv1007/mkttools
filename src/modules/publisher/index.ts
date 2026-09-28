import * as path from 'path';
import { prisma } from '../../utils/db';
import { publishToFacebook } from './providers/facebook';
import { extractCleanText } from '../../utils/clean-text';
import type { PublishResult } from '../../types';

export async function publishContent(contentItemId: string): Promise<PublishResult> {
  const item = await prisma.contentItem.findUnique({
    where: { id: contentItemId },
    include: { page: true },
  });

  if (!item) return { success: false, error: 'Content item not found' };
  if (item.status !== 'APPROVED' && item.status !== 'FAILED') return { success: false, error: `Invalid status: ${item.status}` };
  if (!item.generatedText) return { success: false, error: 'No generated text' };

  const message = extractCleanText(item.generatedText);

  await prisma.contentItem.update({
    where: { id: contentItemId },
    data: { status: 'PUBLISHING' },
  });

  let result: PublishResult;

  switch (item.page.platform) {
    case 'FACEBOOK': {
      const multiImages = item.generatedImages as Array<{url: string; localPath?: string}> | null;
      let imageLocalPath: string | undefined;
      const imageUrl = item.generatedImageUrl || undefined;
      if (imageUrl && imageUrl.includes('/uploads/')) {
        const filename = imageUrl.split('/uploads/').pop();
        if (filename) {
          imageLocalPath = path.join(process.cwd(), 'public', 'uploads', filename);
        }
      }
      const images = multiImages && multiImages.length > 1 ? multiImages : undefined;
      result = await publishToFacebook({
        pageId: item.page.externalId,
        accessToken: item.page.accessToken,
        message,
        imageUrl: images ? undefined : imageUrl,
        imageLocalPath: images ? undefined : imageLocalPath,
        images,
      });
      break;
    }

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
