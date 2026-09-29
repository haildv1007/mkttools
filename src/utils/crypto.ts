import crypto from 'crypto';

const IV_LEN = 12; // GCM standard

/** AES-256-GCM secret box keyed off one master secret. Two independent
 *  instances below (AI credentials vs platform settings) so rotating one
 *  key never affects the other. */
function makeSecretBox(rawKey: string, prefix: string) {
  const KEY = crypto.createHash('sha256').update(rawKey).digest();

  function encrypt(plain: string): string {
    if (!plain) return '';
    const iv = crypto.randomBytes(IV_LEN);
    const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
    const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return prefix + iv.toString('base64') + ':' + tag.toString('base64') + ':' + enc.toString('base64');
  }

  function decrypt(payload: string): string {
    if (!payload) return '';
    if (!payload.startsWith(prefix)) {
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

  return { encrypt, decrypt };
}

// ---- AI credentials (OrganizationAiCredential.encryptedApiKey) ----
const aiBox = makeSecretBox(
  process.env.AI_CREDENTIAL_KEY || process.env.JWT_SECRET || 'mkttools-dev-secret-change-in-production',
  'gcm1:',
);
export const encryptSecret = aiBox.encrypt;
export const decryptSecret = aiBox.decrypt;

// ---- Platform settings (PlatformSetting.value when isSecret) ----
// Dedicated key so it can be rotated independently of AI_CREDENTIAL_KEY.
// Falls back to JWT_SECRET only so a fresh install still boots; set
// PLATFORM_SECRET_KEY explicitly in production.
const platformBox = makeSecretBox(
  process.env.PLATFORM_SECRET_KEY || process.env.JWT_SECRET || 'mkttools-dev-platform-secret-change-in-production',
  'pgcm1:',
);
export const encryptPlatformSecret = platformBox.encrypt;
export const decryptPlatformSecret = platformBox.decrypt;

/** Show only last 4 chars: "AIza••••••••7Kd" */
export function maskSecret(plain: string, showLast = 4): string {
  if (!plain) return '';
  if (plain.length <= showLast + 2) return '••••';
  const head = plain.slice(0, Math.min(4, plain.length - showLast));
  const tail = plain.slice(-showLast);
  return `${head}••••••••${tail}`;
}
