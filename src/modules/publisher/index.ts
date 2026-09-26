import { prisma } from '../../utils/db';
import { publishToFacebook } from './providers/facebook';
import type { PublishResult } from '../../types';

function extractCleanText(raw: string): string {
  try {
    let cleaned = raw.trim();
    const jsonMatch = cleaned.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
    if (jsonMatch) cleaned = jsonMatch[1].trim();
    const parsed = JSON.parse(cleaned);
    if (parsed.text) {
      let text = parsed.text;
      if (parsed.hashtags?.length) {
        text += '\n\n' + parsed.hashtags.map((h: string) => `#${String(h).replace(/^#/, '')}`).join(' ');
      }
      if (parsed.cta) text += '\n\n' + parsed.cta;
      return text;
    }
  } catch {}
  return raw;
}

export async function publishContent(contentItemId: string): Promise<PublishResult> {
  const item = await prisma.contentItem.findUnique({
    where: { id: contentItemId },
    include: { page: true },
  });

  if (!item) return { success: false, error: 'Content item not found' };
  if (item.status !== 'APPROVED') return { success: false, error: `Invalid status: ${item.status}` };
  if (!item.generatedText) return { success: false, error: 'No generated text' };

  const message = extractCleanText(item.generatedText);

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
        message,
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
