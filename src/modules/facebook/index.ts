import { Router, Response } from 'express';
import { AuthRequest } from '../../middleware/auth';
import { prisma } from '../../utils/db';
import { encryptPageToken } from '../../utils/crypto';
import { roleAtLeast } from '../organization';
import { resolveFacebookAppConfig, isAllowedRedirectUri } from './config';
import { createOAuthState, validateAndConsumeOAuthState } from './oauth-state';
import { OrganizationQuota, resolveSubscriptionContext } from '../organization';
import * as redis from './redis';
import { getOrganizationSetting, setOrganizationSettings } from '../settings/organization-settings';

const router = Router();

const FB_GRAPH = 'https://graph.facebook.com/v21.0';
const FB_OAUTH_SCOPES = [
  'business_management',
  'pages_show_list',
  'pages_read_engagement',
  'pages_read_user_content',
  'pages_manage_posts',
  'read_insights',
].join(',');

const USER_TOKEN_TTL = 3300; // 55 min
const DISCOVERED_TOKEN_TTL = 1800; // 30 min

function isAdmin(req: AuthRequest): boolean {
  return roleAtLeast(req.organizationRole, 'ADMIN');
}

type FacebookPageAsset = {
  id: string;
  name: string;
  access_token?: string;
  picture?: { data?: { url?: string } };
  category?: string;
};

type FacebookBusiness = { id: string; name?: string };

async function fetchGraphCollection<T>(path: string, fields: string, accessToken: string): Promise<T[]> {
  const rows: T[] = [];
  let url: string | null = `${FB_GRAPH}/${path}?fields=${encodeURIComponent(fields)}&limit=100&access_token=${encodeURIComponent(accessToken)}`;
  let pageCount = 0;

  while (url && pageCount < 20) {
    const response = await fetch(url);
    const payload = await response.json() as {
      data?: T[];
      paging?: { next?: string };
      error?: { message?: string; code?: number };
    };
    if (!response.ok || payload.error || !payload.data) {
      const error = new Error(payload.error?.message || `Facebook Graph request failed for ${path}`) as Error & { graphCode?: number };
      error.graphCode = payload.error?.code;
      throw error;
    }
    rows.push(...payload.data);
    const next = payload.paging?.next;
    if (!next) break;
    const nextUrl = new URL(next);
    if (nextUrl.protocol !== 'https:' || nextUrl.hostname !== 'graph.facebook.com') {
      throw new Error('Facebook returned an invalid pagination URL.');
    }
    url = nextUrl.toString();
    pageCount += 1;
  }

  return rows;
}

async function resolvePageAccessToken(page: FacebookPageAsset, userToken: string): Promise<FacebookPageAsset | null> {
  if (page.access_token) return page;
  const response = await fetch(
    `${FB_GRAPH}/${encodeURIComponent(page.id)}?fields=id,name,access_token,picture,category&access_token=${encodeURIComponent(userToken)}`
  );
  const payload = await response.json() as FacebookPageAsset & { error?: { message?: string } };
  if (!response.ok || payload.error || !payload.access_token) return null;
  return payload;
}

// ------------------------------------------------------------------
// 1. Start Facebook OAuth
// ------------------------------------------------------------------
router.post('/oauth/start', async (req: AuthRequest, res: Response) => {
  try {
    if (!isAdmin(req)) {
      return res.status(403).json({ error: 'ORGANIZATION_ACCESS_DENIED', message: 'Chỉ Owner/Admin được quản lý kết nối Facebook.' });
    }

    const config = await resolveFacebookAppConfig(req.organizationId!);
    if (!config) {
      return res.status(400).json({ error: 'FACEBOOK_APP_NOT_CONFIGURED', message: 'Chưa cấu hình Facebook App ID / Secret trong Cài đặt tổ chức.' });
    }

    const redirectUri = req.body.redirectUri;
    if (!redirectUri) {
      return res.status(400).json({ error: 'MISSING_REDIRECT_URI', message: 'redirectUri is required.' });
    }

    if (!isAllowedRedirectUri(redirectUri)) {
      return res.status(400).json({ error: 'FACEBOOK_REDIRECT_URI_NOT_ALLOWED', message: 'The provided redirectUri is not in the allowed list.' });
    }

    const state = await createOAuthState(req.userId!, req.organizationId!, redirectUri);

    const oauthUrl = `https://www.facebook.com/v21.0/dialog/oauth?` +
      `client_id=${encodeURIComponent(config.appId)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&state=${encodeURIComponent(state)}` +
      `&scope=${encodeURIComponent(FB_OAUTH_SCOPES)}` +
      `&response_type=code`;

    res.json({ oauthUrl, state });
  } catch (err) {
    res.status(500).json({ error: 'INTERNAL_ERROR', message: err instanceof Error ? err.message : 'Failed to start OAuth' });
  }
});

// ------------------------------------------------------------------
// 2. OAuth Callback - exchange code for tokens
// ------------------------------------------------------------------
router.post('/oauth/callback', async (req: AuthRequest, res: Response) => {
  try {
    const { code, state, redirectUri } = req.body;
    if (!code || !state) {
      return res.status(400).json({ error: 'FACEBOOK_OAUTH_STATE_INVALID', message: 'code and state are required.' });
    }

    const bag = await validateAndConsumeOAuthState(state, req.userId!);
    if (!bag) {
      return res.status(400).json({ error: 'FACEBOOK_OAUTH_STATE_EXPIRED', message: 'OAuth state is invalid, expired, or tampered.' });
    }

    // Use the redirectUri bound at start; reject if client supplies a different one
    const trustedRedirectUri = bag.redirectUri;
    if (redirectUri && redirectUri !== trustedRedirectUri) {
      return res.status(400).json({ error: 'FACEBOOK_REDIRECT_URI_MISMATCH', message: 'redirectUri does not match the one used at OAuth start.' });
    }

    // Enforce that org from state is used, not X-Organization-Id header
    const organizationId = bag.organizationId;

    // Revalidate user membership in the organization from state
    const membership = await prisma.organizationMember.findFirst({
      where: { userId: req.userId!, organizationId, status: 'ACTIVE' },
    });
    if (!membership || !roleAtLeast(membership.role as any, 'ADMIN')) {
      return res.status(403).json({ error: 'ORGANIZATION_ACCESS_DENIED', message: 'You no longer have access to this organization.' });
    }

    const config = await resolveFacebookAppConfig(organizationId);
    if (!config) {
      return res.status(400).json({ error: 'FACEBOOK_APP_NOT_CONFIGURED' });
    }

    // Exchange authorization code for access token
    const tokenRes = await fetch(
      `${FB_GRAPH}/oauth/access_token?` +
      `client_id=${encodeURIComponent(config.appId)}` +
      `&client_secret=${encodeURIComponent(config.appSecret)}` +
      `&redirect_uri=${encodeURIComponent(trustedRedirectUri)}` +
      `&code=${encodeURIComponent(code)}`
    );
    const tokenData = await tokenRes.json() as { access_token?: string; error?: { message: string } };
    if (!tokenData.access_token) {
      return res.status(400).json({ error: 'FACEBOOK_TOKEN_EXCHANGE_FAILED', message: tokenData.error?.message || 'Token exchange failed.' });
    }

    // Exchange for long-lived token
    const llRes = await fetch(
      `${FB_GRAPH}/oauth/access_token?` +
      `grant_type=fb_exchange_token` +
      `&client_id=${encodeURIComponent(config.appId)}` +
      `&client_secret=${encodeURIComponent(config.appSecret)}` +
      `&fb_exchange_token=${encodeURIComponent(tokenData.access_token)}`
    );
    const llData = await llRes.json() as { access_token?: string; error?: { message: string } };
    if (!llData.access_token) {
      return res.status(400).json({ error: 'FACEBOOK_TOKEN_EXCHANGE_FAILED', message: llData.error?.message || 'Long-lived token exchange failed.' });
    }

    // Persist the long-lived user token encrypted for future Page discovery,
    // and cache it in Redis for the current flow. It is never returned.
    await setOrganizationSettings(organizationId, { FACEBOOK_USER_ACCESS_TOKEN: llData.access_token });
    await redis.set(`user_token:${organizationId}:${req.userId}`, llData.access_token, USER_TOKEN_TTL);

    res.json({ success: true, organizationId });
  } catch (err) {
    res.status(500).json({ error: 'INTERNAL_ERROR', message: err instanceof Error ? err.message : 'OAuth callback failed' });
  }
});

// Manual token bridge for apps that are still in Meta development/review mode.
// The submitted user token is exchanged and stored server-side; no Facebook
// token is ever returned to the browser.
router.post('/token/connect', async (req: AuthRequest, res: Response) => {
  try {
    if (!isAdmin(req)) {
      return res.status(403).json({ error: 'ORGANIZATION_ACCESS_DENIED', message: 'Chỉ Owner/Admin được quản lý kết nối Facebook.' });
    }
    const shortToken = typeof req.body?.accessToken === 'string' ? req.body.accessToken.trim() : '';
    if (!shortToken || shortToken.length > 4096) {
      return res.status(400).json({ error: 'FACEBOOK_TOKEN_REQUIRED', message: 'Vui lòng nhập access token hợp lệ.' });
    }
    const config = await resolveFacebookAppConfig(req.organizationId!);
    if (!config) {
      return res.status(400).json({ error: 'FACEBOOK_APP_NOT_CONFIGURED', message: 'Chưa cấu hình Facebook App ID / Secret trong Cài đặt tổ chức.' });
    }
    const llRes = await fetch(
      `${FB_GRAPH}/oauth/access_token?` +
      `grant_type=fb_exchange_token` +
      `&client_id=${encodeURIComponent(config.appId)}` +
      `&client_secret=${encodeURIComponent(config.appSecret)}` +
      `&fb_exchange_token=${encodeURIComponent(shortToken)}`
    );
    const llData = await llRes.json() as { access_token?: string; expires_in?: number; error?: { message: string } };
    if (!llData.access_token) {
      return res.status(400).json({ error: 'FACEBOOK_TOKEN_EXCHANGE_FAILED', message: llData.error?.message || 'Không thể xác thực access token.' });
    }
    const ttl = Math.max(300, Math.min(Number(llData.expires_in) || USER_TOKEN_TTL, 5184000));
    await setOrganizationSettings(req.organizationId!, { FACEBOOK_USER_ACCESS_TOKEN: llData.access_token });
    await redis.set(`user_token:${req.organizationId}:${req.userId}`, llData.access_token, ttl);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'INTERNAL_ERROR', message: err instanceof Error ? err.message : 'Không thể kết nối access token.' });
  }
});

// ------------------------------------------------------------------
// 3. Discover Facebook Pages
// ------------------------------------------------------------------
router.get('/pages/discover', async (req: AuthRequest, res: Response) => {
  try {
    if (!isAdmin(req)) {
      return res.status(403).json({ error: 'ORGANIZATION_ACCESS_DENIED' });
    }

    let userToken = await redis.get(`user_token:${req.organizationId}:${req.userId}`);
    if (!userToken) {
      userToken = await getOrganizationSetting(req.organizationId!, 'FACEBOOK_USER_ACCESS_TOKEN');
      if (userToken) {
        await redis.set(`user_token:${req.organizationId}:${req.userId}`, userToken, USER_TOKEN_TTL);
      }
    }
    if (!userToken) {
      return res.status(400).json({ error: 'FACEBOOK_TOKEN_NOT_CONFIGURED', message: 'Chưa lưu Facebook User Access Token trong Cài đặt hệ thống.' });
    }

    let directPages: FacebookPageAsset[];
    try {
      directPages = await fetchGraphCollection<FacebookPageAsset>(
        'me/accounts',
        'id,name,access_token,picture,category',
        userToken
      );
    } catch (error) {
      const graphError = error as Error & { graphCode?: number };
      const msg = graphError.message || '';
      if (graphError.graphCode === 190) {
        return res.status(400).json({ error: 'FACEBOOK_TOKEN_EXCHANGE_FAILED', message: 'Facebook token expired. Please reconnect.' });
      }
      if (msg.includes('permission')) {
        return res.status(400).json({ error: 'FACEBOOK_PERMISSION_INSUFFICIENT', message: msg });
      }
      return res.status(400).json({ error: 'FACEBOOK_TOKEN_EXCHANGE_FAILED', message: msg || 'Failed to fetch pages.' });
    }

    // Business-owned and partner-shared Pages do not always appear in
    // /me/accounts. Discover them through every Business the user manages.
    // A missing business_management grant must not hide directly assigned
    // Pages, so business discovery remains additive for legacy/manual tokens.
    const businessPages: FacebookPageAsset[] = [];
    try {
      const businesses = await fetchGraphCollection<FacebookBusiness>('me/businesses', 'id,name', userToken);
      for (const business of businesses) {
        for (const edge of ['owned_pages', 'client_pages']) {
          try {
            const assets = await fetchGraphCollection<FacebookPageAsset>(
              `${encodeURIComponent(business.id)}/${edge}`,
              'id,name,access_token,picture,category',
              userToken
            );
            businessPages.push(...assets);
          } catch {
            // A user can administer a Business without access to every edge.
            // Continue discovering assets from the remaining Businesses/edges.
          }
        }
      }
    } catch {
      // Backwards compatibility for tokens created before business_management
      // was granted: direct /me/accounts discovery still works.
    }

    const pageById = new Map<string, FacebookPageAsset>();
    for (const page of [...directPages, ...businessPages]) {
      const current = pageById.get(page.id);
      if (!current || (!current.access_token && page.access_token)) pageById.set(page.id, page);
    }

    const pagesData: FacebookPageAsset[] = [];
    for (const page of pageById.values()) {
      const resolved = await resolvePageAccessToken(page, userToken);
      if (resolved) pagesData.push(resolved);
    }

    // A Facebook Page can be shared with more than one Business/organization.
    // Only mark the Page as imported when it already exists in the current
    // organization; another tenant's connection must not block a valid token
    // discovered through the current user's OAuth session.
    const externalIds = pagesData.map(p => p.id);
    const existingPages = await prisma.page.findMany({
      where: {
        organizationId: req.organizationId!,
        platform: 'FACEBOOK',
        externalId: { in: externalIds },
        isActive: true,
      },
      select: { externalId: true },
    });
    const importedIds = new Set(existingPages.map(p => p.externalId));

    // Store page tokens in Redis for import step (never sent to frontend)
    for (const p of pagesData) {
      await redis.set(`discovered_page:${req.organizationId}:${p.id}`, p.access_token!, DISCOVERED_TOKEN_TTL);
    }

    const pages = pagesData.map(p => ({
      facebookPageId: p.id,
      name: p.name,
      pictureUrl: p.picture?.data?.url || null,
      category: p.category || null,
      alreadyImported: importedIds.has(p.id),
    }));

    res.json({ pages });
  } catch (err) {
    res.status(500).json({ error: 'INTERNAL_ERROR', message: err instanceof Error ? err.message : 'Failed to discover pages' });
  }
});

// ------------------------------------------------------------------
// 4. Import Selected Pages
// ------------------------------------------------------------------
router.post('/pages/import', async (req: AuthRequest, res: Response) => {
  try {
    if (!isAdmin(req)) {
      return res.status(403).json({ error: 'ORGANIZATION_ACCESS_DENIED' });
    }

    const subCtx = await resolveSubscriptionContext(req.organizationId!);
    if (subCtx.status === 'EXPIRED' || subCtx.status === 'NONE') {
      return res.status(402).json({ error: 'SUBSCRIPTION_EXPIRED', message: 'Subscription expired.' });
    }

    const { pageIds } = req.body as { pageIds?: string[] };
    if (!Array.isArray(pageIds) || pageIds.length === 0) {
      return res.status(400).json({ error: 'MISSING_PAGE_IDS', message: 'pageIds array is required.' });
    }

    const results: Array<{ facebookPageId: string; status: string; pageId?: string; error?: string }> = [];

    for (const fbPageId of pageIds) {
      // Validate token came from a valid discovery flow (Redis)
      const pageToken = await redis.get(`discovered_page:${req.organizationId}:${fbPageId}`);
      if (!pageToken) {
        results.push({ facebookPageId: fbPageId, status: 'error', error: 'FACEBOOK_PAGE_NOT_FOUND' });
        continue;
      }

      // Encrypt token before storing
      const encryptedToken = encryptPageToken(pageToken);

      // Check same-org duplicate
      const existingSame = await prisma.page.findFirst({
        where: { platform: 'FACEBOOK', externalId: fbPageId, organizationId: req.organizationId },
      });
      if (existingSame) {
        if (existingSame.isActive) {
          await prisma.page.update({
            where: { id: existingSame.id },
            data: { accessToken: encryptedToken },
          });
          results.push({ facebookPageId: fbPageId, status: 'already_imported', pageId: existingSame.id });
          continue;
        }
        const check = await OrganizationQuota.canAddPage(req.organizationId!);
        if (!check.ok) {
          results.push({ facebookPageId: fbPageId, status: 'error', error: 'PAGE_LIMIT_REACHED' });
          continue;
        }
        await prisma.page.update({
          where: { id: existingSame.id },
          data: { isActive: true, accessToken: encryptedToken },
        });
        results.push({ facebookPageId: fbPageId, status: 'reactivated', pageId: existingSame.id });
        continue;
      }

      const check = await OrganizationQuota.canAddPage(req.organizationId!);
      if (!check.ok) {
        results.push({ facebookPageId: fbPageId, status: 'error', error: 'PAGE_LIMIT_REACHED' });
        continue;
      }

      let pageName = fbPageId;
      try {
        const infoRes = await fetch(`${FB_GRAPH}/${fbPageId}?fields=name&access_token=${encodeURIComponent(pageToken)}`);
        const infoData = await infoRes.json() as { name?: string };
        if (infoData.name) pageName = infoData.name;
      } catch { /* use fbPageId as fallback name */ }

      const page = await prisma.page.create({
        data: {
          organizationId: req.organizationId!,
          platform: 'FACEBOOK',
          name: pageName,
          externalId: fbPageId,
          accessToken: encryptedToken,
          userId: req.userId!,
          isActive: true,
        },
      });
      results.push({ facebookPageId: fbPageId, status: 'imported', pageId: page.id });
    }

    // Cleanup used discovery tokens
    for (const fbPageId of pageIds) {
      await redis.del(`discovered_page:${req.organizationId}:${fbPageId}`);
    }

    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: 'INTERNAL_ERROR', message: err instanceof Error ? err.message : 'Import failed' });
  }
});

// ------------------------------------------------------------------
// 5. Page Status (for "Quản lý Pages" frontend)
// ------------------------------------------------------------------
router.get('/pages/status', async (req: AuthRequest, res: Response) => {
  try {
    const pages = await prisma.page.findMany({
      where: { organizationId: req.organizationId, platform: 'FACEBOOK' },
      select: {
        id: true,
        name: true,
        externalId: true,
        platform: true,
        isActive: true,
        accessToken: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({
      pages: pages.map(p => ({
        id: p.id,
        name: p.name,
        facebookPageId: p.externalId,
        platform: p.platform,
        isActive: p.isActive,
        connected: p.isActive && !!p.accessToken,
        createdAt: p.createdAt,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: 'INTERNAL_ERROR', message: err instanceof Error ? err.message : 'Failed to get page status' });
  }
});

export { router as facebookRouter };
export { resolveFacebookAppConfig, isAllowedRedirectUri } from './config';
export { createOAuthState, validateAndConsumeOAuthState } from './oauth-state';
