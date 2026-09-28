import { prisma } from '../../utils/db';
import { generateText, generateImage } from '../content-generator';
import { extractCleanText } from '../../utils/clean-text';
import { logger } from '../../utils/logger';
import { logActivity, updateActivity, sanitizeError } from '../../utils/activity';
import { emitContentUpdate, emitActivity } from '../../realtime';
import type { RevisionType, RevisionStatus } from '@prisma/client';

function nowISO() { return new Date().toISOString(); }
let _ver = Date.now();
function nextVer() { return ++_ver; }

function emitAct(id: string, opts: any, status?: string) {
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

const REVISION_EXPIRY_MS = 60 * 60 * 1000; // 1 hour

export interface CreateRevisionParams {
  contentItemId: string;
  revisionType: RevisionType;
  selectedMediaIds?: number[];
  source: 'TELEGRAM' | 'WEB';
  chatId?: string;
  userId?: string;
  sourceMessageId?: number;
}

export interface SubmitFeedbackParams {
  sessionId: string;
  feedbackText: string;
  userId?: string;
}

export interface SubmitFeedbackByReplyParams {
  chatId: string;
  replyToMessageId: number;
  feedbackText: string;
  userId?: string;
}

export async function createRevisionSession(params: CreateRevisionParams) {
  // Cancel any existing active sessions for the same content
  await prisma.revisionSession.updateMany({
    where: {
      contentItemId: params.contentItemId,
      status: 'WAITING_FEEDBACK',
    },
    data: { status: 'CANCELLED' },
  });

  // Check content is not currently processing
  const item = await prisma.contentItem.findUnique({
    where: { id: params.contentItemId },
    select: { status: true, topic: true },
  });
  if (!item) throw new Error('Content not found');
  if (['GENERATING', 'PUBLISHING'].includes(item.status)) {
    throw new Error('Nội dung đang được xử lý. Vui lòng chờ hoàn tất.');
  }

  const session = await prisma.revisionSession.create({
    data: {
      contentItemId: params.contentItemId,
      revisionType: params.revisionType,
      selectedMediaIds: params.selectedMediaIds || undefined,
      source: params.source,
      chatId: params.chatId,
      userId: params.userId,
      sourceMessageId: params.sourceMessageId,
      expiresAt: new Date(Date.now() + REVISION_EXPIRY_MS),
    },
  });

  await prisma.contentItem.update({
    where: { id: params.contentItemId },
    data: { status: 'REVISION_REQUESTED' },
  });

  return session;
}

export async function setPromptMessageId(sessionId: string, promptMessageId: number) {
  return prisma.revisionSession.update({
    where: { id: sessionId },
    data: { promptMessageId },
  });
}

export async function findSessionByReply(chatId: string, replyToMessageId: number) {
  // Try matching by promptMessageId first, then sourceMessageId
  let session = await prisma.revisionSession.findFirst({
    where: {
      chatId,
      promptMessageId: replyToMessageId,
      status: 'WAITING_FEEDBACK',
    },
    include: { contentItem: { include: { page: true, campaign: true } } },
  });
  if (session) return session;

  session = await prisma.revisionSession.findFirst({
    where: {
      chatId,
      sourceMessageId: replyToMessageId,
      status: 'WAITING_FEEDBACK',
    },
    include: { contentItem: { include: { page: true, campaign: true } } },
  });
  return session;
}

export async function cancelRevision(sessionId: string) {
  const session = await prisma.revisionSession.findUnique({
    where: { id: sessionId },
    select: { contentItemId: true, status: true },
  });
  if (!session || session.status !== 'WAITING_FEEDBACK') return null;

  await prisma.revisionSession.update({
    where: { id: sessionId },
    data: { status: 'CANCELLED' },
  });

  // Restore content to PENDING_REVIEW
  await prisma.contentItem.update({
    where: { id: session.contentItemId },
    data: { status: 'PENDING_REVIEW' },
  });

  return session;
}

export async function submitFeedbackAndExecute(params: SubmitFeedbackParams) {
  const session = await prisma.revisionSession.findUnique({
    where: { id: params.sessionId },
    include: { contentItem: { include: { page: true, campaign: true } } },
  });
  if (!session) throw new Error('Session not found');
  if (session.status !== 'WAITING_FEEDBACK') throw new Error('Session no longer active');

  // Check expiry
  if (session.expiresAt && session.expiresAt < new Date()) {
    await prisma.revisionSession.update({
      where: { id: session.id },
      data: { status: 'EXPIRED' },
    });
    throw new Error('Session expired. Vui lòng bấm Sửa lại.');
  }

  // Save feedback
  await prisma.revisionSession.update({
    where: { id: session.id },
    data: { feedbackText: params.feedbackText, status: 'PROCESSING' },
  });

  // Log approval
  if (params.userId) {
    await prisma.approvalLog.create({
      data: {
        contentItemId: session.contentItemId,
        userId: params.userId,
        action: 'REQUEST_EDIT',
        feedback: `[${session.revisionType}] ${params.feedbackText}`,
      },
    });
  }

  // Execute revision
  await executeRevision(session.id, session.contentItem, session.revisionType, session.selectedMediaIds as number[] | null, params.feedbackText);

  return session;
}

async function executeRevision(
  sessionId: string,
  item: any,
  revisionType: RevisionType,
  selectedMediaIds: number[] | null,
  feedback: string,
) {
  const cid = item.id;
  const label = item.topic?.slice(0, 80) || cid;

  const opMap: Record<string, string> = {
    TEXT: 'revision_text',
    IMAGE: 'revision_image',
    VIDEO: 'revision_video',
    TEXT_AND_MEDIA: 'revision_text_media',
  };
  const operation = opMap[revisionType] || 'revision';

  const actOpts = {
    action: 'revision',
    category: 'content' as const,
    summary: `Đang sửa: ${label}`,
    entityType: 'content',
    entityId: cid,
    entityLabel: label,
  };
  const actId = await logActivity(actOpts);
  emitAct(actId, actOpts);

  await prisma.contentItem.update({
    where: { id: cid },
    data: { status: 'GENERATING' },
  });

  emitContentUpdate({
    contentId: cid,
    pageId: item.pageId,
    campaignId: item.campaignId || undefined,
    operation: operation as any,
    status: 'started',
    step: revisionStepLabel(revisionType),
    contentTitle: label,
    pageName: item.page?.name,
    contentStatus: 'GENERATING',
    startedAt: nowISO(),
    updatedAt: nowISO(),
    version: nextVer(),
  });

  try {
    let newText = item.generatedText;
    let newImageUrl = item.generatedImageUrl;
    let newImages = item.generatedImages as Array<{ url: string; localPath?: string; description?: string }> | null;

    // TEXT revision
    if (revisionType === 'TEXT' || revisionType === 'TEXT_AND_MEDIA') {
      emitContentUpdate({
        contentId: cid,
        pageId: item.pageId,
        operation: operation as any,
        status: 'progress',
        step: 'Đang sửa nội dung',
        contentTitle: label,
        pageName: item.page?.name,
        contentStatus: 'GENERATING',
        updatedAt: nowISO(),
        version: nextVer(),
      });

      const result = await generateText({
        topic: item.topic,
        pageName: item.page.name,
        pageContext: item.page.context || undefined,
        contentType: item.contentType,
        notes: item.notes || undefined,
        previousFeedback: feedback,
      });

      newText = result.text +
        (result.hashtags.length ? '\n\n' + result.hashtags.map((h: string) => `#${h}`).join(' ') : '') +
        (result.cta ? '\n\n' + result.cta : '');
      newText = extractCleanText(newText);
    }

    // IMAGE revision
    if (revisionType === 'IMAGE' || revisionType === 'TEXT_AND_MEDIA') {
      if (item.contentType === 'IMAGE' || item.contentType === 'VIDEO') {
        const descriptions = item.imageDescriptions
          ? item.imageDescriptions.split('|').map((d: string) => d.trim()).filter(Boolean)
          : [];

        if (newImages && newImages.length > 1 && selectedMediaIds && selectedMediaIds.length > 0) {
          // Selective image revision
          const total = selectedMediaIds.length;
          for (let i = 0; i < selectedMediaIds.length; i++) {
            const idx = selectedMediaIds[i];
            if (idx < 0 || idx >= newImages.length) continue;

            const origDesc = descriptions[idx] || `Image ${idx + 1} for: ${item.topic}`;
            const enhancedPrompt = `${origDesc}\n\nFeedback chỉnh sửa: ${feedback}`;

            emitContentUpdate({
              contentId: cid,
              pageId: item.pageId,
              operation: operation as any,
              status: 'progress',
              step: `Đang sửa ảnh ${idx + 1}`,
              progressCurrent: i + 1,
              progressTotal: total,
              contentTitle: label,
              pageName: item.page?.name,
              contentStatus: 'GENERATING',
              updatedAt: nowISO(),
              version: nextVer(),
            });

            try {
              const imgResult = await generateImage({ prompt: enhancedPrompt });
              newImages[idx] = {
                url: imgResult.url,
                localPath: imgResult.localPath,
                description: origDesc,
              };
            } catch (err) {
              logger.error({ idx, err }, 'Revision image generation failed');
            }
          }
          if (newImages.length > 0) newImageUrl = newImages[0].url;
        } else {
          // Single image or all images
          emitContentUpdate({
            contentId: cid,
            pageId: item.pageId,
            operation: operation as any,
            status: 'progress',
            step: 'Đang sửa ảnh',
            contentTitle: label,
            pageName: item.page?.name,
            contentStatus: 'GENERATING',
            updatedAt: nowISO(),
            version: nextVer(),
          });

          if (descriptions.length > 1) {
            // Regenerate all images with feedback
            const regenImages: typeof newImages = [];
            for (let i = 0; i < descriptions.length; i++) {
              const enhancedPrompt = `${descriptions[i]}\n\nFeedback chỉnh sửa: ${feedback}`;
              try {
                const imgResult = await generateImage({ prompt: enhancedPrompt });
                regenImages.push({ url: imgResult.url, localPath: imgResult.localPath, description: descriptions[i] });

                emitContentUpdate({
                  contentId: cid,
                  pageId: item.pageId,
                  operation: operation as any,
                  status: 'progress',
                  step: 'Đang sửa ảnh',
                  progressCurrent: i + 1,
                  progressTotal: descriptions.length,
                  contentTitle: label,
                  pageName: item.page?.name,
                  contentStatus: 'GENERATING',
                  updatedAt: nowISO(),
                  version: nextVer(),
                });
              } catch (err) {
                logger.error({ i, err }, 'Revision image generation failed');
                if (newImages && newImages[i]) regenImages.push(newImages[i]);
              }
            }
            newImages = regenImages;
            if (newImages.length > 0) newImageUrl = newImages[0].url;
          } else {
            // Single image
            const origDesc = descriptions[0] || `Social media post image for: ${item.topic}`;
            const enhancedPrompt = `${origDesc}\n\nFeedback chỉnh sửa: ${feedback}`;
            try {
              const imgResult = await generateImage({ prompt: enhancedPrompt });
              newImageUrl = imgResult.url;
            } catch (err) {
              logger.error({ err }, 'Revision single image generation failed');
            }
          }
        }
      }
    }

    // VIDEO revision (placeholder — uses same image gen for now)
    if (revisionType === 'VIDEO') {
      emitContentUpdate({
        contentId: cid,
        pageId: item.pageId,
        operation: operation as any,
        status: 'progress',
        step: 'Đang sửa video',
        contentTitle: label,
        pageName: item.page?.name,
        contentStatus: 'GENERATING',
        updatedAt: nowISO(),
        version: nextVer(),
      });
      // Video revision uses the same approach as image with feedback in prompt
      if (item.generatedVideoUrl && item.imageDescriptions) {
        const desc = item.imageDescriptions.split('|')[0]?.trim() || `Video for: ${item.topic}`;
        const enhancedPrompt = `${desc}\n\nFeedback chỉnh sửa: ${feedback}`;
        try {
          const imgResult = await generateImage({ prompt: enhancedPrompt });
          newImageUrl = imgResult.url;
        } catch (err) {
          logger.error({ err }, 'Revision video generation failed');
        }
      }
    }

    // Save revision history
    const lastRevision = await prisma.contentRevision.findFirst({
      where: { contentItemId: cid },
      orderBy: { version: 'desc' },
    });
    if (!lastRevision) {
      // Save original as version 0
      await prisma.contentRevision.create({
        data: {
          contentItemId: cid,
          version: 0,
          generatedText: item.generatedText,
          generatedImages: item.generatedImages ? JSON.parse(JSON.stringify(item.generatedImages)) : undefined,
          feedback: null,
          source: 'ORIGINAL',
        },
      });
    }
    const nextVersion = (lastRevision?.version ?? 0) + 1;
    await prisma.contentRevision.create({
      data: {
        contentItemId: cid,
        version: nextVersion,
        generatedText: newText,
        generatedImages: newImages ? JSON.parse(JSON.stringify(newImages)) : undefined,
        feedback,
        source: item.source === 'TELEGRAM' ? 'TELEGRAM' : 'WEB',
      },
    });

    // Update content
    await prisma.contentItem.update({
      where: { id: cid },
      data: {
        generatedText: newText,
        generatedImageUrl: newImageUrl,
        generatedImages: newImages ? JSON.parse(JSON.stringify(newImages)) : undefined,
        status: 'PENDING_REVIEW',
      },
    });

    // Complete session
    await prisma.revisionSession.update({
      where: { id: sessionId },
      data: { status: 'COMPLETED' },
    });

    emitContentUpdate({
      contentId: cid,
      pageId: item.pageId,
      campaignId: item.campaignId || undefined,
      operation: operation as any,
      status: 'completed',
      contentTitle: label,
      pageName: item.page?.name,
      campaignName: item.campaign?.name,
      thumbnailUrl: newImageUrl || undefined,
      contentStatus: 'PENDING_REVIEW',
      safeMessage: 'Đã chỉnh sửa xong, chờ duyệt',
      updatedAt: nowISO(),
      version: nextVer(),
    });

    const actSummary = `Sửa xong: ${label}`;
    await updateActivity(actId, { status: 'success', summary: actSummary });
    emitAct(actId, { ...actOpts, summary: actSummary }, 'success');

    return { success: true };
  } catch (err) {
    const safe = sanitizeError(err);

    await prisma.contentItem.update({
      where: { id: cid },
      data: { status: 'FAILED', errorMessage: safe.message },
    });

    await prisma.revisionSession.update({
      where: { id: sessionId },
      data: { status: 'CANCELLED' },
    });

    emitContentUpdate({
      contentId: cid,
      pageId: item.pageId,
      operation: operation as any,
      status: 'failed',
      contentTitle: label,
      pageName: item.page?.name,
      contentStatus: 'FAILED',
      safeMessage: safe.message,
      updatedAt: nowISO(),
      version: nextVer(),
    });

    await updateActivity(actId, { status: 'error', summary: `Sửa thất bại: ${label}`, detail: safe.message, errorCode: safe.code });
    emitAct(actId, { ...actOpts, summary: `Sửa thất bại: ${label}`, detail: safe.message, errorCode: safe.code }, 'error');

    throw err;
  }
}

function revisionStepLabel(type: RevisionType): string {
  switch (type) {
    case 'TEXT': return 'Đang sửa nội dung';
    case 'IMAGE': return 'Đang sửa ảnh';
    case 'VIDEO': return 'Đang sửa video';
    case 'TEXT_AND_MEDIA': return 'Đang sửa nội dung + ảnh';
  }
}

export async function getActiveRevisionSession(contentItemId: string) {
  return prisma.revisionSession.findFirst({
    where: {
      contentItemId,
      status: { in: ['WAITING_FEEDBACK', 'PROCESSING'] },
    },
  });
}
