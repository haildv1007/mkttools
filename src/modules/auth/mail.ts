import nodemailer from 'nodemailer';
import { logger } from '../../utils/logger';

export const APP_URL = (process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, '');

let transport: ReturnType<typeof nodemailer.createTransport> | null = null;
function getTransport() {
  if (!process.env.SMTP_HOST) return null;
  transport ??= nodemailer.createTransport({
    host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS || '' } : undefined,
  });
  return transport;
}

/** Transactional mail only. Never logs secrets; never throws to callers. */
export async function sendMail(to: string, subject: string, text: string): Promise<boolean> {
  const t = getTransport();
  if (!t) {
    // Dev-only escape hatch so flows are testable without SMTP. Refused in production.
    if (process.env.MAIL_DEV_LOG_LINKS === '1' && process.env.NODE_ENV !== 'production') {
      logger.info({ to, subject }, `MAIL_DEV_LOG ${text}`);
      return true;
    }
    logger.error({ to, subject }, 'MAIL_NOT_CONFIGURED: set SMTP_HOST/SMTP_USER/SMTP_PASS/MAIL_FROM to send email');
    return false;
  }
  try {
    await t.sendMail({ from: process.env.MAIL_FROM || 'MKT Tools <no-reply@mkttools.local>', to, subject, text });
    return true;
  } catch (e) {
    logger.error({ to, subject, err: e instanceof Error ? e.message : 'unknown' }, 'MAIL_SEND_FAILED');
    return false;
  }
}

export const sendVerificationEmail = (to: string, name: string, token: string) =>
  sendMail(to, 'Xác minh email MKT Tools', `Xin chào ${name},\n\nVui lòng xác minh email của bạn:\n${APP_URL}/verify-email/${token}\n\nLiên kết có hiệu lực 24 giờ.`);
export const sendPasswordResetEmail = (to: string, token: string) =>
  sendMail(to, 'Đặt lại mật khẩu MKT Tools', `Bạn (hoặc ai đó) đã yêu cầu đặt lại mật khẩu.\n${APP_URL}/reset-password/${token}\n\nLiên kết có hiệu lực 1 giờ và chỉ dùng được một lần. Nếu không phải bạn, hãy bỏ qua email này.`);
