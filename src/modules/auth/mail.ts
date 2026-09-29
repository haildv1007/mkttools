import nodemailer from 'nodemailer';
import { logger } from '../../utils/logger';
import { getAppUrl, getMailTransportConfig } from '../platform-settings';

/** Kept as a function (not a frozen const) so a platform-settings change to
 *  general.appUrl takes effect without a restart. */
export function APP_URL(): string { return getAppUrl(); }

let cachedKey = '';
let cachedTransport: ReturnType<typeof nodemailer.createTransport> | null = null;

function getTransport() {
  const cfg = getMailTransportConfig();
  if (!cfg) return null;
  const key = JSON.stringify(cfg);
  if (!cachedTransport || key !== cachedKey) {
    cachedTransport = nodemailer.createTransport({
      host: cfg.host, port: cfg.port, secure: cfg.secure,
      auth: cfg.user ? { user: cfg.user, pass: cfg.pass } : undefined,
    });
    cachedKey = key;
  }
  return { transport: cachedTransport, cfg };
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
    logger.error({ to, subject }, 'MAIL_NOT_CONFIGURED: set SMTP in Platform Admin \u2192 C\u1ea5u h\u00ecnh n\u1ec1n t\u1ea3ng \u2192 Email (or SMTP_HOST/SMTP_USER/SMTP_PASS env)');
    return false;
  }
  try {
    await t.transport.sendMail({ from: `${t.cfg.fromName} <${t.cfg.fromEmail}>`, to, subject, text });
    return true;
  } catch (e) {
    logger.error({ to, subject, err: e instanceof Error ? e.message : 'unknown' }, 'MAIL_SEND_FAILED');
    return false;
  }
}

export const sendVerificationEmail = (to: string, name: string, token: string) =>
  sendMail(to, 'Xác minh email MKT Tools', `Xin chào ${name},\n\nVui lòng xác minh email của bạn:\n${APP_URL()}/verify-email/${token}\n\nLiên kết có hiệu lực 24 giờ.`);
export const sendPasswordResetEmail = (to: string, token: string) =>
  sendMail(to, 'Đặt lại mật khẩu MKT Tools', `Bạn (hoặc ai đó) đã yêu cầu đặt lại mật khẩu.\n${APP_URL()}/reset-password/${token}\n\nLiên kết có hiệu lực 1 giờ và chỉ dùng được một lần. Nếu không phải bạn, hãy bỏ qua email này.`);
