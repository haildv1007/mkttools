import TelegramBot from 'node-telegram-bot-api';
import { prisma } from '../../utils/db';
import { config } from '../../config';
import { generateText } from '../content-generator';
import {
  createRevisionSession,
  setPromptMessageId,
  findSessionByReply,
  cancelRevision,
  submitFeedbackAndExecute,
} from '../revision';
import type { TelegramApprovalPayload } from '../../types';
import { extractCleanText } from '../../utils/clean-text';
import type { RevisionType } from '@prisma/client';

let bot: TelegramBot | null = null;

export function getBot(): TelegramBot | null {
  if (!config.telegram.botToken) {
    return null;
  }
  if (!bot) {
    bot = new TelegramBot(config.telegram.botToken, { polling: true });
    setupHandlers(bot);
  }
  return bot;
}

function defaultKeyboard(contentItemId: string) {
  return {
    inline_keyboard: [
      [
        { text: '✅ Duyệt', callback_data: `approve:${contentItemId}` },
        { text: '✏️ Sửa', callback_data: `edit:${contentItemId}` },
        { text: '❌ Hủy', callback_data: `reject:${contentItemId}` },
      ],
      [
        { text: '🔄 Gen lại', callback_data: `regenerate:${contentItemId}` },
      ],
    ],
  };
}

function revisionTypeKeyboard(contentItemId: string, contentType: string) {
  const rows: Array<Array<{ text: string; callback_data: string }>> = [];

  if (contentType === 'TEXT') {
    rows.push([{ text: '📝 Nội dung', callback_data: `rev_text:${contentItemId}` }]);
  } else {
    rows.push([{ text: '📝 Nội dung', callback_data: `rev_text:${contentItemId}` }]);
    if (contentType === 'IMAGE') {
      rows.push([{ text: '🖼 Hình ảnh', callback_data: `rev_image:${contentItemId}` }]);
      rows.push([{ text: '✨ Nội dung + Ảnh', callback_data: `rev_both:${contentItemId}` }]);
    } else if (contentType === 'VIDEO') {
      rows.push([{ text: '🎬 Video', callback_data: `rev_video:${contentItemId}` }]);
      rows.push([{ text: '✨ Nội dung + Video', callback_data: `rev_both:${contentItemId}` }]);
    }
  }
  rows.push([{ text: '↩️ Quay lại', callback_data: `rev_cancel:${contentItemId}` }]);
  return { inline_keyboard: rows };
}

function imageSelectKeyboard(contentItemId: string, imageCount: number) {
  const rows: Array<Array<{ text: string; callback_data: string }>> = [];
  for (let i = 0; i < imageCount; i++) {
    rows.push([{ text: `🖼 Ảnh ${i + 1}`, callback_data: `rev_img_sel:${contentItemId}:${i}` }]);
  }
  rows.push([{ text: '📷 Tất cả ảnh', callback_data: `rev_img_sel:${contentItemId}:all` }]);
  rows.push([{ text: '↩️ Quay lại', callback_data: `rev_cancel:${contentItemId}` }]);
  return { inline_keyboard: rows };
}

function setupHandlers(bot: TelegramBot) {
  bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id,
      '🤖 MKT Tools Bot\n\nBot duyệt content marketing tự động.\n\n' +
      'Commands:\n/pending - Xem content chờ duyệt\n/stats - Thống kê hôm nay'
    );
  });

  bot.onText(/\/pending/, async (msg) => {
    if (!(await isAdmin(msg.chat.id))) return;

    const items = await prisma.contentItem.findMany({
      where: { status: 'PENDING_REVIEW' },
      include: { page: true, campaign: true },
      orderBy: { scheduledAt: 'asc' },
      take: 10,
    });

    if (items.length === 0) {
      bot.sendMessage(msg.chat.id, '✅ Không có content nào chờ duyệt.');
      return;
    }

    bot.sendMessage(msg.chat.id, `📋 Có ${items.length} content chờ duyệt:`);
    for (const item of items) {
      await sendApprovalMessage(msg.chat.id, item);
    }
  });

  bot.onText(/\/stats/, async (msg) => {
    if (!(await isAdmin(msg.chat.id))) return;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const stats = await prisma.contentItem.groupBy({
      by: ['status'],
      where: { scheduledAt: { gte: today, lt: tomorrow } },
      _count: true,
    });

    const lines = stats.map(s => `  ${statusEmoji(s.status)} ${s.status}: ${s._count}`);
    bot.sendMessage(msg.chat.id,
      `📊 Thống kê hôm nay:\n${lines.join('\n') || '  Chưa có content nào'}`
    );
  });

  bot.on('callback_query', async (query) => {
    if (!query.data || !query.message) return;

    const parts = query.data.split(':');
    const action = parts[0];
    const contentItemId = parts[1];
    if (!contentItemId || contentItemId === '0') {
      bot.answerCallbackQuery(query.id);
      return;
    }

    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;
    const userId = await findUserByTelegramChat(String(chatId));

    // Handle noop
    if (action === 'noop') {
      bot.answerCallbackQuery(query.id);
      return;
    }

    // Validate content exists for content-related actions
    const item = await prisma.contentItem.findUnique({
      where: { id: contentItemId },
      include: { page: true, campaign: true },
    });
    if (!item) {
      bot.answerCallbackQuery(query.id, { text: 'Content không tồn tại' });
      return;
    }

    switch (action) {
      case 'approve': {
        await prisma.contentItem.update({
          where: { id: contentItemId },
          data: { status: 'APPROVED' },
        });
        if (userId) {
          await prisma.approvalLog.create({
            data: { contentItemId, userId, action: 'APPROVE' },
          });
        }
        bot.answerCallbackQuery(query.id, { text: '✅ Đã duyệt!' });
        bot.editMessageReplyMarkup(
          { inline_keyboard: [[{ text: '✅ ĐÃ DUYỆT', callback_data: 'noop:0' }]] },
          { chat_id: chatId, message_id: messageId }
        );
        break;
      }

      case 'reject': {
        await prisma.contentItem.update({
          where: { id: contentItemId },
          data: { status: 'CANCELLED' },
        });
        if (userId) {
          await prisma.approvalLog.create({
            data: { contentItemId, userId, action: 'REJECT' },
          });
        }
        bot.answerCallbackQuery(query.id, { text: '❌ Đã hủy' });
        bot.editMessageReplyMarkup(
          { inline_keyboard: [[{ text: '❌ ĐÃ HỦY', callback_data: 'noop:0' }]] },
          { chat_id: chatId, message_id: messageId }
        );
        break;
      }

      case 'edit': {
        // Show revision type selection keyboard
        if (['GENERATING', 'PUBLISHING'].includes(item.status)) {
          bot.answerCallbackQuery(query.id, { text: 'Nội dung đang xử lý, vui lòng chờ.' });
          return;
        }
        bot.answerCallbackQuery(query.id, { text: 'Chọn phần cần sửa' });
        bot.editMessageReplyMarkup(
          revisionTypeKeyboard(contentItemId, item.contentType),
          { chat_id: chatId, message_id: messageId }
        );
        break;
      }

      case 'rev_text': {
        await startRevisionFlow(bot, chatId, messageId, contentItemId, 'TEXT', null, userId, query.id);
        break;
      }

      case 'rev_image': {
        const images = item.generatedImages as Array<any> | null;
        if (images && images.length > 1) {
          // Show image selection keyboard
          bot.answerCallbackQuery(query.id, { text: 'Chọn ảnh cần sửa' });
          bot.editMessageReplyMarkup(
            imageSelectKeyboard(contentItemId, images.length),
            { chat_id: chatId, message_id: messageId }
          );
        } else {
          await startRevisionFlow(bot, chatId, messageId, contentItemId, 'IMAGE', null, userId, query.id);
        }
        break;
      }

      case 'rev_video': {
        await startRevisionFlow(bot, chatId, messageId, contentItemId, 'VIDEO', null, userId, query.id);
        break;
      }

      case 'rev_both': {
        const revType: RevisionType = 'TEXT_AND_MEDIA';
        const imgs = item.generatedImages as Array<any> | null;
        if (imgs && imgs.length > 1) {
          bot.answerCallbackQuery(query.id, { text: 'Chọn ảnh cần sửa' });
          bot.editMessageReplyMarkup(
            imageSelectKeyboard(contentItemId, imgs.length),
            { chat_id: chatId, message_id: messageId }
          );
          // Store that this is TEXT_AND_MEDIA in a temp way — we'll use callback data
          // Actually, we need to differentiate. Let's use rev_both_img_sel callback
        } else {
          await startRevisionFlow(bot, chatId, messageId, contentItemId, revType, null, userId, query.id);
        }
        break;
      }

      case 'rev_img_sel': {
        // parts[2] = image index or 'all'
        const imgSel = parts[2];
        const selectedIds = imgSel === 'all' ? null : [parseInt(imgSel, 10)];

        // Detect if this was from a TEXT_AND_MEDIA flow or IMAGE-only
        // Check if there's an existing waiting session to determine type, otherwise default to IMAGE
        const existingSession = await prisma.revisionSession.findFirst({
          where: { contentItemId, status: 'WAITING_FEEDBACK', chatId: String(chatId) },
        });
        const revisionType: RevisionType = existingSession?.revisionType === 'TEXT_AND_MEDIA' ? 'TEXT_AND_MEDIA' : 'IMAGE';

        await startRevisionFlow(bot, chatId, messageId, contentItemId, revisionType, selectedIds, userId, query.id);
        break;
      }

      case 'rev_cancel': {
        // Cancel active revision session if any and restore keyboard
        const activeSession = await prisma.revisionSession.findFirst({
          where: { contentItemId, status: 'WAITING_FEEDBACK' },
        });
        if (activeSession) {
          await cancelRevision(activeSession.id);
        }
        bot.answerCallbackQuery(query.id, { text: 'Đã hủy chỉnh sửa' });
        bot.editMessageReplyMarkup(
          defaultKeyboard(contentItemId),
          { chat_id: chatId, message_id: messageId }
        );
        break;
      }

      case 'regenerate': {
        if (['GENERATING', 'PUBLISHING'].includes(item.status)) {
          bot.answerCallbackQuery(query.id, { text: 'Nội dung đang xử lý, vui lòng chờ.' });
          return;
        }
        bot.answerCallbackQuery(query.id, { text: '🔄 Đang gen lại...' });
        bot.editMessageReplyMarkup(
          { inline_keyboard: [[{ text: '⏳ Đang gen lại...', callback_data: 'noop:0' }]] },
          { chat_id: chatId, message_id: messageId }
        );
        await handleRegenerate(contentItemId, chatId);
        break;
      }
    }
  });

  // Reply handler — route feedback by reply_to_message_id
  bot.on('message', async (msg) => {
    if (!msg.reply_to_message || !msg.text) return;
    if (!(await isAdmin(msg.chat.id))) return;

    const replyToId = msg.reply_to_message.message_id;
    const chatIdStr = String(msg.chat.id);

    // Find revision session by reply
    const session = await findSessionByReply(chatIdStr, replyToId);

    if (!session) {
      // Legacy fallback: try old content# pattern
      const replyText = msg.reply_to_message.text || '';
      const match = replyText.match(/content #([a-z0-9]+)/i);
      if (!match) return;

      const partialId = match[1];
      const legacyItem = await prisma.contentItem.findFirst({
        where: { id: { endsWith: partialId }, status: 'REVISION_REQUESTED' },
        include: { page: true },
      });
      if (!legacyItem) return;

      const userId = await findUserByTelegramChat(chatIdStr);
      if (userId) {
        await prisma.approvalLog.create({
          data: { contentItemId: legacyItem.id, userId, action: 'REQUEST_EDIT', feedback: msg.text },
        });
      }
      bot.sendMessage(msg.chat.id, '🔄 Đang gen lại theo feedback...');
      await handleRegenerate(legacyItem.id, msg.chat.id, msg.text);
      return;
    }

    // Check expiry
    if (session.expiresAt && session.expiresAt < new Date()) {
      await prisma.revisionSession.update({ where: { id: session.id }, data: { status: 'EXPIRED' } });
      bot.sendMessage(msg.chat.id, '⏰ Yêu cầu sửa đã hết hạn. Vui lòng bấm Sửa lại.', {
        reply_to_message_id: msg.message_id,
      });
      return;
    }

    const userId = await findUserByTelegramChat(chatIdStr);

    // Delete prompt message if exists
    if (session.promptMessageId) {
      try { await bot.deleteMessage(msg.chat.id, session.promptMessageId); } catch {}
    }

    // Edit control message to show processing
    if (session.sourceMessageId) {
      try {
        bot.editMessageReplyMarkup(
          { inline_keyboard: [[{ text: '⏳ Đang chỉnh sửa...', callback_data: 'noop:0' }]] },
          { chat_id: msg.chat.id, message_id: session.sourceMessageId }
        );
      } catch {}
    }

    try {
      await submitFeedbackAndExecute({
        sessionId: session.id,
        feedbackText: msg.text,
        userId: userId || undefined,
      });

      // Revision complete — send updated approval message
      const updatedItem = await prisma.contentItem.findUnique({
        where: { id: session.contentItemId },
        include: { page: true, campaign: true },
      });
      if (updatedItem) {
        await sendApprovalMessage(msg.chat.id, updatedItem);
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Lỗi không xác định';
      bot.sendMessage(msg.chat.id, `❌ Chỉnh sửa thất bại: ${errMsg}`, {
        reply_to_message_id: msg.message_id,
      });

      // Restore keyboard on source message
      if (session.sourceMessageId) {
        try {
          bot.editMessageReplyMarkup(
            defaultKeyboard(session.contentItemId),
            { chat_id: msg.chat.id, message_id: session.sourceMessageId }
          );
        } catch {}
      }
    }
  });
}

async function startRevisionFlow(
  bot: TelegramBot,
  chatId: number,
  sourceMessageId: number,
  contentItemId: string,
  revisionType: RevisionType,
  selectedMediaIds: number[] | null,
  userId: string | null,
  queryId: string,
) {
  try {
    const session = await createRevisionSession({
      contentItemId,
      revisionType,
      selectedMediaIds: selectedMediaIds || undefined,
      source: 'TELEGRAM',
      chatId: String(chatId),
      userId: userId || undefined,
      sourceMessageId,
    });

    const typeLabels: Record<string, string> = {
      TEXT: 'nội dung',
      IMAGE: 'hình ảnh',
      VIDEO: 'video',
      TEXT_AND_MEDIA: 'nội dung + media',
    };
    const label = typeLabels[revisionType] || 'nội dung';
    const mediaNote = selectedMediaIds ? ` (ảnh ${selectedMediaIds.map(i => i + 1).join(', ')})` : '';

    bot.answerCallbackQuery(queryId, { text: `✏️ Sửa ${label}` });

    // Edit control message keyboard to show waiting state
    bot.editMessageReplyMarkup(
      { inline_keyboard: [
        [{ text: `✏️ Đang chờ feedback sửa ${label}${mediaNote}`, callback_data: 'noop:0' }],
        [{ text: '↩️ Hủy sửa', callback_data: `rev_cancel:${contentItemId}` }],
      ] },
      { chat_id: chatId, message_id: sourceMessageId }
    );

    // Send a prompt message (ForceReply for UX)
    const promptMsg = await bot.sendMessage(chatId,
      `✏️ Reply tin nhắn này với yêu cầu chỉnh sửa ${label}${mediaNote}:`,
      {
        reply_to_message_id: sourceMessageId,
        reply_markup: { force_reply: true, selective: true },
      }
    );

    // Save prompt message id for reply routing
    await setPromptMessageId(session.id, promptMsg.message_id);

  } catch (err) {
    const errMsg = err instanceof Error ? err.message : 'Lỗi';
    bot.answerCallbackQuery(queryId, { text: errMsg });
    // Restore default keyboard
    bot.editMessageReplyMarkup(
      defaultKeyboard(contentItemId),
      { chat_id: chatId, message_id: sourceMessageId }
    );
  }
}

async function handleRegenerate(contentItemId: string, chatId: number, feedback?: string) {
  const item = await prisma.contentItem.findUnique({
    where: { id: contentItemId },
    include: { page: true },
  });
  if (!item) return;

  try {
    await prisma.contentItem.update({
      where: { id: contentItemId },
      data: { status: 'GENERATING' },
    });

    const result = await generateText({
      topic: item.topic,
      pageName: item.page.name,
      pageContext: item.page.context || undefined,
      contentType: item.contentType,
      notes: item.notes || undefined,
      previousFeedback: feedback,
    });

    let fullText = result.text +
      (result.hashtags.length ? '\n\n' + result.hashtags.map(h => `#${h}`).join(' ') : '') +
      (result.cta ? '\n\n' + result.cta : '');
    fullText = extractCleanText(fullText);

    await prisma.contentItem.update({
      where: { id: contentItemId },
      data: { generatedText: fullText, status: 'PENDING_REVIEW' },
    });

    await sendApprovalMessage(chatId, {
      ...item,
      generatedText: fullText,
      status: 'PENDING_REVIEW',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    await prisma.contentItem.update({
      where: { id: contentItemId },
      data: { status: 'FAILED', errorMessage: message },
    });
    getBot()?.sendMessage(chatId, `❌ Lỗi gen content: ${message}`);
  }
}

interface ContentItemWithPage {
  id: string;
  scheduledAt: Date;
  topic: string;
  generatedText: string | null;
  generatedImageUrl?: string | null;
  generatedImages?: unknown;
  status?: string;
  page: { name: string; platform: string };
  campaign?: { name: string } | null;
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function sendApprovalMessage(chatId: number, item: ContentItemWithPage) {
  const scheduledStr = item.scheduledAt.toLocaleString('vi-VN', { timeZone: config.timezone });
  const contentText = item.generatedText ? extractCleanText(item.generatedText) : '(Chưa gen content)';
  const text = `📝 <b>Content chờ duyệt</b>\n\n` +
    `📌 Page: ${escapeHtml(item.page.name)} (${item.page.platform})\n` +
    `📅 Lịch đăng: ${scheduledStr}\n` +
    `💡 Chủ đề: ${escapeHtml(item.topic)}\n` +
    (item.campaign ? `📂 Campaign: ${escapeHtml(item.campaign.name)}\n` : '') +
    `\n---\n\n${escapeHtml(contentText)}`;

  const replyMarkup = defaultKeyboard(item.id);

  const multiImages = item.generatedImages as Array<{url: string; localPath?: string}> | undefined;
  if (multiImages && multiImages.length > 1) {
    try {
      const fsModule = await import('fs');
      const pathModule = await import('path');
      const media: Array<{type: 'photo'; media: string; caption?: string; parse_mode?: string}> = multiImages.map((img, i) => {
        let source = img.url;
        if (img.localPath && fsModule.existsSync(img.localPath)) {
          source = img.localPath;
        } else if (img.url.includes('/uploads/')) {
          const fn = img.url.split('/uploads/').pop();
          const lp = pathModule.join(process.cwd(), 'public', 'uploads', fn || '');
          if (fsModule.existsSync(lp)) source = lp;
        }
        return {
          type: 'photo' as const,
          media: source,
          ...(i === 0 ? { caption: text.substring(0, 1024), parse_mode: 'HTML' } : {}),
        };
      });
      await getBot()?.sendMediaGroup(chatId, media as never);
      await getBot()?.sendMessage(chatId, 'Chọn hành động:', { reply_markup: replyMarkup });
      return;
    } catch (err) {
      console.error('Failed to send media group to Telegram:', err);
    }
  }

  if (item.generatedImageUrl) {
    try {
      let photoSource: string;
      if (item.generatedImageUrl.includes('/uploads/')) {
        const filename = item.generatedImageUrl.split('/uploads/').pop();
        const fsModule = await import('fs');
        const pathModule = await import('path');
        const localPath = pathModule.join(process.cwd(), 'public', 'uploads', filename || '');
        if (fsModule.existsSync(localPath)) {
          photoSource = localPath;
        } else {
          photoSource = item.generatedImageUrl;
        }
      } else {
        photoSource = item.generatedImageUrl;
      }
      await getBot()?.sendPhoto(chatId, photoSource, {
        caption: text.substring(0, 1024),
        parse_mode: 'HTML',
        reply_markup: replyMarkup,
      });
      return;
    } catch (err) {
      console.error('Failed to send photo to Telegram:', err);
    }
  }

  getBot()?.sendMessage(chatId, text, {
    parse_mode: 'HTML',
    reply_markup: replyMarkup,
  });
}

export async function sendContentForApproval(payload: TelegramApprovalPayload) {
  const item = await prisma.contentItem.findUnique({
    where: { id: payload.contentItemId },
    include: { page: true, campaign: true },
  });
  if (!item) return;

  const pageGroupId = item.page?.telegramGroupId;
  const chatIds = pageGroupId ? [pageGroupId] : config.telegram.adminChatIds;

  for (const chatId of chatIds) {
    await sendApprovalMessage(Number(chatId), item);
  }
}

async function isAdmin(chatId: number): Promise<boolean> {
  if (config.telegram.adminChatIds.includes(String(chatId))) return true;
  const page = await prisma.page.findFirst({ where: { telegramGroupId: String(chatId) } });
  return !!page;
}

async function findUserByTelegramChat(chatId: string): Promise<string | null> {
  const user = await prisma.user.findFirst({ where: { telegramChatId: chatId } });
  return user?.id || null;
}

function statusEmoji(status: string): string {
  const map: Record<string, string> = {
    DRAFT: '📝', GENERATING: '⚙️', PENDING_REVIEW: '👀',
    APPROVED: '✅', PUBLISHED: '🚀', FAILED: '❌', CANCELLED: '🚫',
  };
  return map[status] || '❓';
}
