import { getOrganizationSetting } from '../settings/organization-settings';

export interface FacebookAppConfig {
  appId: string;
  appSecret: string;
}

/**
 * Today: returns Organization-scoped Facebook App config.
 * Later: can return one shared platform Facebook App config.
 */
export async function resolveFacebookAppConfig(organizationId: string): Promise<FacebookAppConfig | null> {
  const [appId, appSecret] = await Promise.all([
    getOrganizationSetting(organizationId, 'FACEBOOK_APP_ID'),
    getOrganizationSetting(organizationId, 'FACEBOOK_APP_SECRET'),
  ]);
  if (!appId || !appSecret) return null;
  return { appId, appSecret };
}

const ALLOWED_CALLBACK_ORIGINS = new Set([
  ...(process.env.FACEBOOK_ALLOWED_CALLBACK_URLS || '').split(',').map(s => s.trim()).filter(Boolean),
]);

const LOCAL_DEV_PATTERNS = [
  /^https?:\/\/localhost(:\d+)?/,
  /^https?:\/\/127\.0\.0\.1(:\d+)?/,
  /^https?:\/\/\[::1\](:\d+)?/,
];

export function isAllowedRedirectUri(uri: string): boolean {
  if (ALLOWED_CALLBACK_ORIGINS.has(uri)) return true;
  try {
    const parsed = new URL(uri);
    for (const pattern of LOCAL_DEV_PATTERNS) {
      if (pattern.test(parsed.origin)) return true;
    }
    // Allow same-origin as the running app
    const appUrl = process.env.APP_URL;
    if (appUrl) {
      const appOrigin = new URL(appUrl).origin;
      if (parsed.origin === appOrigin) return true;
    }
  } catch {
    return false;
  }
  return false;
}
