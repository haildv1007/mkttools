import crypto from 'crypto';

const RAW = process.env.AI_CREDENTIAL_KEY || process.env.JWT_SECRET || 'mkttools-dev-secret-change-in-production';
// Derive a stable 32-byte key from whatever secret is available.
const KEY = crypto.createHash('sha256').update(RAW).digest();

const IV_LEN = 12; // GCM standard
const PREFIX = 'gcm1:';

/** AES-256-GCM. Returns "gcm1:<iv b64>:<tag b64>:<ciphertext b64>". */
export function encryptSecret(plain: string): string {
  if (!plain) return '';
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + iv.toString('base64') + ':' + tag.toString('base64') + ':' + enc.toString('base64');
}

export function decryptSecret(payload: string): string {
  if (!payload) return '';
  if (!payload.startsWith(PREFIX)) {
    // Backwards-compat: treat unprefixed value as already-plaintext (legacy).
    return payload;
  }
  const [, ivB64, tagB64, ctB64] = payload.split(':');
  const iv = Buffer.from(ivB64!, 'base64');
  const tag = Buffer.from(tagB64!, 'base64');
  const ct = Buffer.from(ctB64!, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(ct), decipher.final()]);
  return dec.toString('utf8');
}

/** Show only last 4 chars: "AIza••••••••7Kd" */
export function maskSecret(plain: string, showLast = 4): string {
  if (!plain) return '';
  if (plain.length <= showLast + 2) return '••••';
  const head = plain.slice(0, Math.min(4, plain.length - showLast));
  const tail = plain.slice(-showLast);
  return `${head}••••••••${tail}`;
}
