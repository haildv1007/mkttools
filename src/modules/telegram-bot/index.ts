import TelegramBot from 'node-telegram-bot-api';
import { prisma } from '../../utils/db';
import { config } from '../../config';
import { generateText } from '../content-generator';
import type { TelegramApprovalPayload } from '../../types';
import { extractCleanText } from '../../utils/clean-text';
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

function setupHandlers(bot: TelegramBot) {
  bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id,
      '🤖 MKT Tools Bot\n\nBot duyệt content marketing tự động.\n\n' +
      'Commands:\n/pending - Xem content chờ duyệt\n/stats - Thống kê hôm nay'
    );
  });

  bot.onText(/\/pending/, async (msg) => {
    if (!isAdmin(msg.chat.id)) return;

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
    if (!isAdmin(msg.chat.id)) return;

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

    const [action, contentItemId] = query.data.split(':');
    if (!contentItemId) return;

    const item = await prisma.contentItem.findUnique({
      where: { id: contentItemId },
      include: { page: true },
    });
    if (!item) {
      bot.answerCallbackQuery(query.id, { text: 'Content không tồn tại' });
      return;
    }

    const userId = await findUserByTelegramChat(String(query.message.chat.id));

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
          { chat_id: query.message.chat.id, message_id: query.message.message_id }
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
          { chat_id: query.message.chat.id, message_id: query.message.message_id }
        );
        break;
      }

      case 'edit': {
        await prisma.contentItem.update({
          where: { id: contentItemId },
          data: { status: 'REVISION_REQUESTED' },
        });
        bot.answerCallbackQuery(query.id, { text: '✏️ Reply tin nhắn này với feedback' });
        bot.sendMessage(query.message.chat.id,
          `✏️ Hãy reply tin nhắn này với yêu cầu chỉnh sửa cho content #${contentItemId.slice(-6)}:`,
          { reply_to_message_id: query.message.message_id }
        );
        break;
      }

      case 'regenerate': {
        bot.answerCallbackQuery(query.id, { text: '🔄 Đang gen lại...' });
        await handleRegenerate(contentItemId, query.message.chat.id);
        break;
      }
    }
  });

  bot.on('message', async (msg) => {
    if (!msg.reply_to_message || !msg.text) return;
    if (!isAdmin(msg.chat.id)) return;

    const replyText = msg.reply_to_message.text || '';
    const match = replyText.match(/content #([a-z0-9]+)/i);
    if (!match) return;

    const partialId = match[1];
    const item = await prisma.contentItem.findFirst({
      where: { id: { endsWith: partialId }, status: 'REVISION_REQUESTED' },
      include: { page: true },
    });
    if (!item) return;

    const userId = await findUserByTelegramChat(String(msg.chat.id));
    if (userId) {
      await prisma.approvalLog.create({
        data: {
          contentItemId: item.id,
          userId,
          action: 'REQUEST_EDIT',
          feedback: msg.text,
        },
      });
    }

    bot.sendMessage(msg.chat.id, '🔄 Đang gen lại theo feedback...');
    await handleRegenerate(item.id, msg.chat.id, msg.text);
  });
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

  const replyMarkup = {
    inline_keyboard: [
      [
        { text: '✅ Duyệt', callback_data: `approve:${item.id}` },
        { text: '✏️ Sửa', callback_data: `edit:${item.id}` },
        { text: '❌ Hủy', callback_data: `reject:${item.id}` },
      ],
      [
        { text: '🔄 Gen lại', callback_data: `regenerate:${item.id}` },
      ],
    ],
  };

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
  for (const chatId of config.telegram.adminChatIds) {
    const item = await prisma.contentItem.findUnique({
      where: { id: payload.contentItemId },
      include: { page: true, campaign: true },
    });
    if (item) {
      await sendApprovalMessage(Number(chatId), item);
    }
  }
}

function isAdmin(chatId: number): boolean {
  return config.telegram.adminChatIds.includes(String(chatId));
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
