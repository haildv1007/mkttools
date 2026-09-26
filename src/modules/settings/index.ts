import { prisma } from '../../utils/db';

const SETTING_KEYS = [
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_ADMIN_CHAT_IDS',
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'GEMINI_API_KEY',
  'REPLICATE_API_KEY',
  'AI_TEXT_PROVIDER',
  'AI_TEXT_MODEL',
  'AI_IMAGE_PROVIDER',
  'AI_IMAGE_MODEL',
  'FACEBOOK_APP_ID',
  'FACEBOOK_APP_SECRET',
  'DEFAULT_TIMEZONE',
] as const;

export async function getSetting(key: string): Promise<string | null> {
  const row = await prisma.appSetting.findUnique({ where: { key } });
  if (row) return row.value;
  return process.env[key] || null;
}

export async function getSettings(): Promise<Record<string, string>> {
  const rows = await prisma.appSetting.findMany();
  const result: Record<string, string> = {};
  for (const key of SETTING_KEYS) {
    const row = rows.find(r => r.key === key);
    result[key] = row?.value ?? process.env[key] ?? '';
  }
  return result;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await prisma.appSetting.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  });
}

export async function setSettings(data: Record<string, string>): Promise<void> {
  const ops = Object.entries(data)
    .filter(([key]) => (SETTING_KEYS as readonly string[]).includes(key))
    .map(([key, value]) =>
      prisma.appSetting.upsert({
        where: { key },
        update: { value },
        create: { key, value },
      })
    );
  await prisma.$transaction(ops);
}

export async function getSettingOrEnv(key: string, fallback = ''): Promise<string> {
  return (await getSetting(key)) || fallback;
}
