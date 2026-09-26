import dotenv from 'dotenv';
dotenv.config();

function required(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
}

export const config = {
  port: parseInt(process.env.PORT || '3000'),
  nodeEnv: process.env.NODE_ENV || 'development',

  database: {
    url: required('DATABASE_URL'),
  },

  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
  },

  ai: {
    text: {
      provider: process.env.AI_TEXT_PROVIDER || 'claude',
      anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
      openaiApiKey: process.env.OPENAI_API_KEY || '',
      geminiApiKey: process.env.GEMINI_API_KEY || '',
      defaultModel: process.env.AI_TEXT_MODEL || 'claude-haiku-4-5-20251001',
    },
    image: {
      provider: process.env.AI_IMAGE_PROVIDER || 'gemini',
      replicateApiKey: process.env.REPLICATE_API_KEY || '',
      openaiApiKey: process.env.OPENAI_API_KEY || '',
      defaultModel: process.env.AI_IMAGE_MODEL || 'flux-schnell',
    },
  },

  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN || '',
    adminChatIds: (process.env.TELEGRAM_ADMIN_CHAT_IDS || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean),
  },

  facebook: {
    appId: process.env.FACEBOOK_APP_ID || '',
    appSecret: process.env.FACEBOOK_APP_SECRET || '',
  },

  timezone: process.env.DEFAULT_TIMEZONE || 'Asia/Ho_Chi_Minh',
} as const;
