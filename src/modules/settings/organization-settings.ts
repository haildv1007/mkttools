import { prisma } from '../../utils/db';
import { decryptPlatformSecret, encryptPlatformSecret, maskSecret } from '../../utils/crypto';

export const ORGANIZATION_SETTING_KEYS = [
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_ADMIN_CHAT_IDS',
  'FACEBOOK_APP_ID',
  'FACEBOOK_APP_SECRET',
  'DEFAULT_TIMEZONE',
] as const;

type OrganizationSettingKey = typeof ORGANIZATION_SETTING_KEYS[number];

const SECRET_KEYS = new Set<OrganizationSettingKey>([
  'TELEGRAM_BOT_TOKEN',
  'FACEBOOK_APP_SECRET',
]);

function isAllowedKey(key: string): key is OrganizationSettingKey {
  return (ORGANIZATION_SETTING_KEYS as readonly string[]).includes(key);
}

export async function getOrganizationSetting(organizationId: string, key: OrganizationSettingKey): Promise<string | null> {
  const row = await prisma.organizationSetting.findUnique({
    where: { organizationId_key: { organizationId, key } },
  });
  if (!row) return null;
  if (!row.isSecret) return row.value;
  try { return decryptPlatformSecret(row.value); } catch { return null; }
}

export async function getOrganizationSettings(organizationId: string, masked = false): Promise<Record<string, string>> {
  const rows = await prisma.organizationSetting.findMany({ where: { organizationId } });
  const byKey = new Map(rows.map((row) => [row.key, row]));
  const result: Record<string, string> = {};
  for (const key of ORGANIZATION_SETTING_KEYS) {
    const row = byKey.get(key);
    if (!row) {
      result[key] = '';
      continue;
    }
    if (!row.isSecret) {
      result[key] = row.value;
      continue;
    }
    try {
      const plain = decryptPlatformSecret(row.value);
      result[key] = masked && plain ? maskSecret(plain, 6) : plain;
    } catch {
      result[key] = '';
    }
  }
  return result;
}

export async function setOrganizationSettings(organizationId: string, data: Record<string, unknown>): Promise<void> {
  const ops = Object.entries(data).flatMap(([key, raw]) => {
    if (!isAllowedKey(key) || typeof raw !== 'string' || raw.startsWith('••••')) return [];
    const isSecret = SECRET_KEYS.has(key);
    const value = isSecret && raw ? encryptPlatformSecret(raw.trim()) : raw.trim();
    return [prisma.organizationSetting.upsert({
      where: { organizationId_key: { organizationId, key } },
      update: { value, isSecret },
      create: { organizationId, key, value, isSecret },
    })];
  });
  await prisma.$transaction(ops);
}
