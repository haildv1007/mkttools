import { Router, Response } from 'express';
import { prisma } from '../../utils/db';
import { AuthRequest } from '../../middleware/auth';
import { encryptPlatformSecret, decryptPlatformSecret, maskSecret } from '../../utils/crypto';
import { logActivity } from '../../utils/activity';
import { getSetting as getLegacySetting } from '../settings';
import nodemailer from 'nodemailer';
import multer from 'multer';
import sharp from 'sharp';
import path from 'path';
import { promises as fs } from 'fs';

// ---------------------------------------------------------------------------
// Field catalog: one place naming every platform setting, whether it's a
// secret, and (for safe DB-wins-else-env rollout - see class docstring on
// PlatformSetting in schema.prisma) which env var it may fall back to.
// ---------------------------------------------------------------------------

type FieldType = 'string' | 'bool' | 'int';
interface FieldDef { key: string; secret?: boolean; envFallback?: string; type: FieldType; default?: string }

const FIELDS: Record<string, FieldDef[]> = {
  general: [
    { key: 'general.productName', type: 'string', default: 'MKT Tools' },
    { key: 'general.appUrl', type: 'string', envFallback: 'APP_URL' },
    { key: 'general.supportEmail', type: 'string' },
    { key: 'general.timezone', type: 'string', envFallback: 'DEFAULT_TIMEZONE', default: 'Asia/Ho_Chi_Minh' },
    { key: 'general.allowRegistrations', type: 'bool', default: 'true' },
    // trialEnabled is intentionally NOT here - it proxies TrialPolicy (see below).
  ],
  auth: [
    { key: 'auth.emailPasswordEnabled', type: 'bool', default: 'true' },
    { key: 'auth.googleEnabled', type: 'bool' }, // default computed (see resolveGoogleEnabledDefault)
    { key: 'auth.googleClientId', type: 'string', envFallback: 'GOOGLE_CLIENT_ID' },
    { key: 'auth.googleClientSecret', type: 'string', secret: true, envFallback: 'GOOGLE_CLIENT_SECRET' },
    { key: 'auth.googleRedirectUri', type: 'string', envFallback: 'GOOGLE_REDIRECT_URI' },
    { key: 'auth.emailVerificationRequired', type: 'bool', default: 'false' },
  ],
  email: [
    { key: 'email.smtpHost', type: 'string', envFallback: 'SMTP_HOST' },
    { key: 'email.smtpPort', type: 'string', envFallback: 'SMTP_PORT', default: '587' },
    { key: 'email.smtpUser', type: 'string', envFallback: 'SMTP_USER' },
    { key: 'email.smtpPassword', type: 'string', secret: true, envFallback: 'SMTP_PASS' },
    { key: 'email.fromEmail', type: 'string', default: 'no-reply@mkttools.local' },
    { key: 'email.fromName', type: 'string', default: 'MKT Tools' },
    { key: 'email.secure', type: 'bool', envFallback: 'SMTP_SECURE', default: 'false' },
  ],
  payment: [
    { key: 'payment.enabled', type: 'bool', default: 'false' },
    { key: 'payment.provider', type: 'string', default: 'SEPAY' },
    { key: 'payment.mode', type: 'string', default: 'SANDBOX' },
    { key: 'payment.orderTtlMinutes', type: 'int', default: '30' },
    { key: 'payment.sepayApiKey', type: 'string', secret: true },
    { key: 'payment.sepayBankAccount', type: 'string' },
    { key: 'payment.sepayBankName', type: 'string' },
    { key: 'payment.sepayAccountName', type: 'string' },
  ],
  billing: [
    { key: 'billing.currency', type: 'string', default: 'VND' },
    { key: 'billing.allowedPeriods', type: 'string', default: '1,3,12' }, // CSV of months
  ],
  support: [
    { key: 'support.enabled', type: 'bool', default: 'true' },
    { key: 'support.title', type: 'string', default: 'Hỗ trợ khách hàng' },
    { key: 'support.subtitle', type: 'string', default: 'Đội ngũ luôn sẵn sàng hỗ trợ bạn' },
    { key: 'support.messengerEnabled', type: 'bool', default: 'false' },
    { key: 'support.messengerLabel', type: 'string', default: 'Messenger' },
    { key: 'support.messengerUrl', type: 'string' },
    { key: 'support.telegramEnabled', type: 'bool', default: 'false' },
    { key: 'support.telegramLabel', type: 'string', default: 'Telegram' },
    { key: 'support.telegramUrl', type: 'string' },
    { key: 'support.zaloEnabled', type: 'bool', default: 'false' },
    { key: 'support.zaloLabel', type: 'string', default: 'Zalo' },
    { key: 'support.zaloUrl', type: 'string' },
  ],
  seo: [
    { key: 'seo.siteName', type: 'string', default: 'MKTKit' },
    { key: 'seo.defaultTitle', type: 'string', default: 'MKTKit - Công cụ quản lý nội dung & Facebook Pages' },
    { key: 'seo.defaultDescription', type: 'string', default: 'MKTKit giúp đội ngũ marketing quản lý Pages, nội dung, chiến dịch và lịch xuất bản trong một nơi.' },
    { key: 'seo.canonicalBaseUrl', type: 'string' },
    { key: 'seo.allowIndexing', type: 'bool', default: 'true' },
    { key: 'seo.logoUrl', type: 'string' },
    { key: 'seo.faviconUrl', type: 'string' },
    { key: 'seo.ogTitle', type: 'string' },
    { key: 'seo.ogDescription', type: 'string' },
    { key: 'seo.ogImageUrl', type: 'string' },
    { key: 'seo.googleSiteVerification', type: 'string' },
    { key: 'seo.locale', type: 'string', default: 'vi_VN' },
  ],
};

const ALL_FIELDS: FieldDef[] = Object.values(FIELDS).flat();
const FIELD_BY_KEY: Map<string, FieldDef> = new Map(ALL_FIELDS.map((f) => [f.key, f]));
const DASH_NORMALIZED_KEYS = new Set([
  'general.productName', 'email.fromName', 'seo.siteName', 'seo.defaultTitle',
  'seo.defaultDescription', 'seo.ogTitle', 'seo.ogDescription',
]);
const normalizeDashes = (value: string) => value.replace(/[\u2014\u2013]/g, '-');

// ---------------------------------------------------------------------------
// In-memory cache - loaded at boot and refreshed on every save, so settings
// take effect immediately without a PM2 restart (values are read
// synchronously by auth/mail code on the hot path).
// ---------------------------------------------------------------------------

let cache: Record<string, string> = {};
let loaded = false;

export async function refreshPlatformSettingsCache(): Promise<void> {
  const rows = await prisma.platformSetting.findMany();
  const next: Record<string, string> = {};
  for (const row of rows) {
    if (row.value == null) continue;
    next[row.key] = row.isSecret ? safeDecrypt(row.value) : row.value;
  }
  cache = next;
  loaded = true;
}

function safeDecrypt(value: string): string {
  try { return decryptPlatformSecret(value); } catch { return ''; }
}

async function ensureLoaded(): Promise<void> {
  if (!loaded) await refreshPlatformSettingsCache();
}

/** Sync accessor for hot-path code (auth, mail). Priority: DB > env fallback > default. */
export function getPlatformSetting(key: string): string {
  const def = FIELD_BY_KEY.get(key);
  const dbVal = cache[key];
  if (dbVal !== undefined && dbVal !== '') return dbVal;
  if (def?.envFallback && process.env[def.envFallback]) return process.env[def.envFallback]!;
  return def?.default ?? '';
}

export function getPlatformSettingBool(key: string): boolean {
  const v = getPlatformSetting(key);
  return v === 'true' || v === '1';
}

/** google.enabled() special-cases its default: if the admin never touched
 *  the toggle, an install that already has env credentials keeps working
 *  (safe rollout - see schema docstring), otherwise it defaults off. */
export function resolveGoogleEnabled(): boolean {
  const dbVal = cache['auth.googleEnabled'];
  if (dbVal !== undefined && dbVal !== '') return dbVal === 'true';
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export function getAppUrl(): string {
  return (getPlatformSetting('general.appUrl') || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, '');
}

// ---------------------------------------------------------------------------
// Mail: builds a transporter from platform settings (DB-first), used by
// auth/mail.ts sendMail() and the "send test email" admin action.
// ---------------------------------------------------------------------------

export function getMailTransportConfig(): { host: string; port: number; secure: boolean; user: string; pass: string; fromEmail: string; fromName: string } | null {
  const host = getPlatformSetting('email.smtpHost');
  if (!host) return null;
  return {
    host,
    port: Number(getPlatformSetting('email.smtpPort') || '587'),
    secure: getPlatformSettingBool('email.secure'),
    user: getPlatformSetting('email.smtpUser'),
    pass: getPlatformSetting('email.smtpPassword'),
    fromEmail: getPlatformSetting('email.fromEmail'),
    fromName: getPlatformSetting('email.fromName'),
  };
}

// ---------------------------------------------------------------------------
// Serialization: never return a secret's plaintext. A configured secret
// reports { configured: true } only.
// ---------------------------------------------------------------------------

function serializeSection(section: keyof typeof FIELDS): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of FIELDS[section]) {
    const short = f.key.split('.')[1];
    if (f.secret) {
      const configured = !!cache[f.key];
      out[short] = configured ? { configured: true, masked: maskSecret(cache[f.key]) } : { configured: false };
    } else if (f.key === 'auth.googleEnabled') {
      out[short] = resolveGoogleEnabled();
    } else if (f.type === 'bool') {
      out[short] = getPlatformSettingBool(f.key);
    } else if (f.type === 'int') {
      out[short] = Number(getPlatformSetting(f.key));
    } else {
      const value = getPlatformSetting(f.key);
      out[short] = DASH_NORMALIZED_KEYS.has(f.key) ? normalizeDashes(value) : value;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Routes - mounted at /api/admin/settings, already behind requirePlatformAdmin
// (see admin/index.ts: router.use(requirePlatformAdmin) applies to everything
// mounted on that router, this one included).
// ---------------------------------------------------------------------------

const router = Router();
const seoImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => callback(null, file.mimetype.startsWith('image/')),
});
const SEO_UPLOAD_DIR = path.join(process.cwd(), 'public', 'uploads', 'seo');

router.get('/', async (_req: AuthRequest, res: Response) => {
  await ensureLoaded();
  const trial = await prisma.trialPolicy.findUnique({ where: { id: 'trial_policy_singleton' } });
  res.json({
    general: { ...serializeSection('general'), trialEnabled: trial?.trialEnabled ?? true },
    auth: serializeSection('auth'),
    email: serializeSection('email'),
    payment: serializePaymentSection(),
    billing: {
      ...serializeSection('billing'),
      allowedPeriods: getPlatformSetting('billing.allowedPeriods').split(',').map((s) => Number(s.trim())).filter(Boolean),
    },
    support: serializeSection('support'),
    seo: serializeSection('seo'),
  });
});

router.get('/integrations', async (_req: AuthRequest, res: Response) => {
  // Read-only summary of EXISTING integrations (legacy AppSetting-backed -
  // see "Cài đặt hệ thống" for editing). Not duplicated storage.
  const telegramToken = await getLegacySetting('TELEGRAM_BOT_TOKEN');
  const fbAppId = await getLegacySetting('FACEBOOK_APP_ID');
  const fbAppSecret = await getLegacySetting('FACEBOOK_APP_SECRET');
  res.json({
    telegram: { configured: !!telegramToken },
    facebook: { configured: !!(fbAppId && fbAppSecret) },
  });
});

async function saveFields(section: keyof typeof FIELDS, body: Record<string, unknown>, actorUserId?: string): Promise<void> {
  const ops: Promise<unknown>[] = [];
  for (const f of FIELDS[section]) {
    const short = f.key.split('.')[1];
    if (!(short in body)) continue;
    const raw = body[short];

    if (f.secret) {
      // Blank/undefined must never erase an already-saved secret.
      if (raw === undefined || raw === null || raw === '') continue;
      if (typeof raw !== 'string') continue;
      ops.push(prisma.platformSetting.upsert({
        where: { key: f.key },
        update: { value: encryptPlatformSecret(raw), isSecret: true, updatedBy: actorUserId },
        create: { key: f.key, value: encryptPlatformSecret(raw), isSecret: true, updatedBy: actorUserId },
      }));
      continue;
    }

    let value = f.type === 'bool' ? String(!!raw) : String(raw ?? '');
    if (DASH_NORMALIZED_KEYS.has(f.key)) value = normalizeDashes(value);
    ops.push(prisma.platformSetting.upsert({
      where: { key: f.key },
      update: { value, isSecret: false, updatedBy: actorUserId },
      create: { key: f.key, value, isSecret: false, updatedBy: actorUserId },
    }));
  }
  await Promise.all(ops);
  await refreshPlatformSettingsCache();
}

/** Secret field "Xóa" - explicit delete, distinct from a blank save (which is a no-op). */
async function clearSecret(key: string, actorUserId?: string): Promise<void> {
  await prisma.platformSetting.upsert({
    where: { key },
    update: { value: null, isSecret: true, updatedBy: actorUserId },
    create: { key, value: null, isSecret: true, updatedBy: actorUserId },
  });
  await refreshPlatformSettingsCache();
}

router.put('/general', async (req: AuthRequest, res: Response) => {
  const body = req.body || {};
  await saveFields('general', body, req.userId);
  if (body.trialEnabled != null) {
    await prisma.trialPolicy.upsert({
      where: { id: 'trial_policy_singleton' },
      update: { trialEnabled: Boolean(body.trialEnabled) },
      create: { id: 'trial_policy_singleton', trialEnabled: Boolean(body.trialEnabled) },
    });
  }
  await logActivity({ organizationId: null, category: 'admin', status: 'success', action: 'admin.platform_settings', summary: 'Cập nhật cấu hình chung', detail: `by ${req.userId}` });
  res.json({ general: { ...serializeSection('general'), trialEnabled: (await prisma.trialPolicy.findUnique({ where: { id: 'trial_policy_singleton' } }))?.trialEnabled ?? true } });
});

router.put('/auth', async (req: AuthRequest, res: Response) => {
  await saveFields('auth', req.body || {}, req.userId);
  await logActivity({ organizationId: null, category: 'admin', status: 'success', action: 'admin.platform_settings', summary: 'Cập nhật cấu hình đăng nhập', detail: `by ${req.userId}` });
  res.json({ auth: serializeSection('auth') });
});
router.delete('/auth/google-secret', async (req: AuthRequest, res: Response) => {
  await clearSecret('auth.googleClientSecret', req.userId);
  res.json({ auth: serializeSection('auth') });
});

router.put('/email', async (req: AuthRequest, res: Response) => {
  await saveFields('email', req.body || {}, req.userId);
  await logActivity({ organizationId: null, category: 'admin', status: 'success', action: 'admin.platform_settings', summary: 'Cập nhật cấu hình email', detail: `by ${req.userId}` });
  res.json({ email: serializeSection('email') });
});
router.delete('/email/smtp-password', async (req: AuthRequest, res: Response) => {
  await clearSecret('email.smtpPassword', req.userId);
  res.json({ email: serializeSection('email') });
});

router.post('/email/test', async (req: AuthRequest, res: Response) => {
  const to = String(req.body?.to || '').trim();
  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(to)) {
    return res.status(400).json({ ok: false, message: 'Email nhận thử không hợp lệ.' });
  }
  const cfg = getMailTransportConfig();
  if (!cfg) return res.status(400).json({ ok: false, message: 'Chưa cấu hình SMTP Host.' });
  try {
    const transport = nodemailer.createTransport({
      host: cfg.host, port: cfg.port, secure: cfg.secure,
      auth: cfg.user ? { user: cfg.user, pass: cfg.pass } : undefined,
    });
    await transport.sendMail({
      from: `${cfg.fromName} <${cfg.fromEmail}>`, to,
      subject: 'MKT Tools - Email thử nghiệm',
      text: 'Đây là email thử nghiệm từ Cấu hình nền tảng → Email. Nếu bạn nhận được email này, cấu hình SMTP đang hoạt động.',
    });
    res.json({ ok: true, message: 'Đã gửi email thử nghiệm.' });
  } catch (e) {
    res.status(400).json({ ok: false, message: e instanceof Error ? e.message : 'Gửi email thất bại.' });
  }
});

router.put('/payment', async (req: AuthRequest, res: Response) => {
  await saveFields('payment', req.body || {}, req.userId);
  await logActivity({ organizationId: null, category: 'admin', status: 'success', action: 'admin.platform_settings', summary: 'Cập nhật cấu hình thanh toán', detail: `by ${req.userId}` });
  res.json({ payment: serializePaymentSection() });
});
router.delete('/payment/sepay-api-key', async (req: AuthRequest, res: Response) => {
  await clearSecret('payment.sepayApiKey', req.userId);
  res.json({ payment: serializePaymentSection() });
});

router.put('/billing', async (req: AuthRequest, res: Response) => {
  const body = req.body || {};
  if (Array.isArray(body.allowedPeriods)) {
    const periods = body.allowedPeriods.map((n: unknown) => Number(n)).filter((n: number) => [1, 3, 12].includes(n));
    if (!periods.length) return res.status(400).json({ error: 'INVALID_INPUT', message: 'Cần ít nhất 1 kỳ hạn hợp lệ (1/3/12 tháng).' });
    await prisma.platformSetting.upsert({
      where: { key: 'billing.allowedPeriods' },
      update: { value: periods.join(','), isSecret: false, updatedBy: req.userId },
      create: { key: 'billing.allowedPeriods', value: periods.join(','), isSecret: false, updatedBy: req.userId },
    });
    await refreshPlatformSettingsCache();
  }
  await logActivity({ organizationId: null, category: 'admin', status: 'success', action: 'admin.platform_settings', summary: 'Cập nhật cấu hình billing', detail: `by ${req.userId}` });
  res.json({ billing: { ...serializeSection('billing'), allowedPeriods: getPlatformSetting('billing.allowedPeriods').split(',').map((s) => Number(s.trim())).filter(Boolean) } });
});

router.put('/support', async (req: AuthRequest, res: Response) => {
  const body = req.body || {};
  for (const key of ['messengerUrl', 'telegramUrl', 'zaloUrl']) {
    const value = String(body[key] ?? '').trim();
    if (!value) continue;
    try {
      const parsed = new URL(value);
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('protocol');
    } catch {
      return res.status(400).json({ error: 'INVALID_URL', message: `${key} phải là URL http(s) hợp lệ.` });
    }
  }
  await saveFields('support', body, req.userId);
  await logActivity({ organizationId: null, category: 'admin', status: 'success', action: 'admin.platform_settings', summary: 'Cập nhật popup hỗ trợ', detail: `by ${req.userId}` });
  res.json({ support: serializeSection('support') });
});

router.put('/seo', async (req: AuthRequest, res: Response) => {
  const body = req.body || {};
  for (const key of ['canonicalBaseUrl', 'logoUrl', 'faviconUrl', 'ogImageUrl']) {
    const value = String(body[key] ?? '').trim();
    if (!value) continue;
    if (key !== 'canonicalBaseUrl' && value.startsWith('/uploads/seo/')) continue;
    try {
      const parsed = new URL(value);
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('protocol');
    } catch {
      return res.status(400).json({ error: 'INVALID_URL', message: `${key} phải là URL http(s) hợp lệ.` });
    }
  }
  await saveFields('seo', body, req.userId);
  await logActivity({ organizationId: null, category: 'admin', status: 'success', action: 'admin.platform_settings', summary: 'Cập nhật SEO & Website', detail: `by ${req.userId}` });
  res.json({ seo: serializeSection('seo') });
});

router.post('/seo/upload/:kind', seoImageUpload.single('image'), async (req: AuthRequest, res: Response) => {
  const kind = String(req.params.kind);
  const definitions: Record<string, { key: string; filename: string }> = {
    logo: { key: 'logoUrl', filename: 'logo.png' },
    favicon: { key: 'faviconUrl', filename: 'favicon.png' },
    og: { key: 'ogImageUrl', filename: 'open-graph.jpg' },
  };
  const definition = definitions[kind];
  if (!definition) return res.status(404).json({ error: 'INVALID_IMAGE_KIND', message: 'Loại ảnh không hợp lệ.' });
  if (!req.file) return res.status(400).json({ error: 'IMAGE_REQUIRED', message: 'Vui lòng chọn một file ảnh.' });

  try {
    await fs.mkdir(SEO_UPLOAD_DIR, { recursive: true });
    const outputPath = path.join(SEO_UPLOAD_DIR, definition.filename);
    const image = sharp(req.file.buffer, { failOn: 'error' }).rotate();
    if (kind === 'favicon') {
      await image.resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toFile(outputPath);
    } else if (kind === 'og') {
      await image.resize(1200, 630, { fit: 'cover', position: 'centre' }).jpeg({ quality: 88 }).toFile(outputPath);
    } else {
      await image.resize({ width: 1200, height: 400, fit: 'inside', withoutEnlargement: true }).png().toFile(outputPath);
    }
    const publicUrl = `/uploads/seo/${definition.filename}?v=${Date.now()}`;
    await saveFields('seo', { [definition.key]: publicUrl }, req.userId);
    await logActivity({ organizationId: null, category: 'admin', status: 'success', action: 'admin.platform_settings', summary: `Tải lên ${kind} cho website`, detail: `by ${req.userId}` });
    res.json({ url: publicUrl, seo: serializeSection('seo') });
  } catch {
    res.status(400).json({ error: 'INVALID_IMAGE', message: 'File không phải ảnh hợp lệ hoặc không thể xử lý.' });
  }
});

function serializePaymentSection() {
  const apiKeyConfigured = !!cache['payment.sepayApiKey'];
  const bankAccount = getPlatformSetting('payment.sepayBankAccount');
  const configured = apiKeyConfigured && !!bankAccount;
  return {
    ...serializeSection('payment'),
    webhookUrl: `${getAppUrl()}/api/payments/sepay/webhook`,
    webhookConfigured: configured,
    sepayConfigured: configured,
  };
}

export function getSePayConfig() {
  const apiKey = getPlatformSetting('payment.sepayApiKey');
  const bankAccount = getPlatformSetting('payment.sepayBankAccount');
  const bankName = getPlatformSetting('payment.sepayBankName');
  const accountName = getPlatformSetting('payment.sepayAccountName');
  const mode = getPlatformSetting('payment.mode') as 'SANDBOX' | 'PRODUCTION';
  const enabled = getPlatformSettingBool('payment.enabled');
  return { apiKey, bankAccount, bankName, accountName, mode, enabled, configured: !!apiKey && !!bankAccount };
}

export function getOrderTtlMs(): number {
  return (Number(getPlatformSetting('payment.orderTtlMinutes')) || 30) * 60 * 1000;
}

export { router as platformSettingsAdminRouter };
