import * as path from 'path';
import { prisma } from '../../utils/db';
import { decryptPageToken } from '../../utils/crypto';
import { publishToFacebook } from './providers/facebook';
import { extractCleanText } from '../../utils/clean-text';
import type { PublishResult } from '../../types';
import { resolvePublicMediaUrl } from '../../utils/public-media-url';

function localUploadPath(mediaUrl?: string | null): string | undefined {
  if (!mediaUrl) return undefined;
  try {
    const parsed = new URL(mediaUrl, 'https://local.invalid');
    if (!parsed.pathname.startsWith('/uploads/')) return undefined;
    const relativePath = decodeURIComponent(parsed.pathname.slice('/uploads/'.length));
    if (!relativePath || relativePath.split('/').includes('..')) return undefined;
    return path.join(process.cwd(), 'public', 'uploads', relativePath);
  } catch { return undefined; }
}

export async function publishContent(contentItemId: string, expectedOrganizationId?: string): Promise<PublishResult> {
  const item = await prisma.contentItem.findUnique({
    where: { id: contentItemId },
    include: { page: true },
  });

  if (!item) return { success: false, error: 'Content item not found' };
  if (expectedOrganizationId && item.organizationId !== expectedOrganizationId) {
    return { success: false, error: 'Queue organization mismatch' };
  }
  if (item.page.organizationId !== item.organizationId) {
    return { success: false, error: 'Content/page organization mismatch' };
  }
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
      const storedImageUrl = item.generatedImageUrl || undefined;
      const imageUrl = storedImageUrl ? resolvePublicMediaUrl(storedImageUrl) : undefined;
      const imageLocalPath = localUploadPath(storedImageUrl);
      const images = multiImages && multiImages.length > 1
        ? multiImages.map((image) => ({
            url: resolvePublicMediaUrl(image.url),
            localPath: image.localPath || localUploadPath(image.url),
          }))
        : undefined;
      const pageAccessToken = decryptPageToken(item.page.accessToken);
      result = await publishToFacebook({
        pageId: item.page.externalId,
        accessToken: pageAccessToken,
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
