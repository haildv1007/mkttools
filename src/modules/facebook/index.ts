import { Router, Response } from 'express';
import { AuthRequest } from '../../middleware/auth';
import { prisma } from '../../utils/db';
import { encryptPageToken } from '../../utils/crypto';
import { roleAtLeast } from '../organization';
import { resolveFacebookAppConfig, isAllowedRedirectUri } from './config';
import { createOAuthState, validateAndConsumeOAuthState } from './oauth-state';
import { OrganizationQuota, resolveSubscriptionContext } from '../organization';
import * as redis from './redis';

const router = Router();

const FB_GRAPH = 'https://graph.facebook.com/v21.0';
const FB_OAUTH_SCOPES = 'pages_show_list,pages_read_engagement,pages_manage_posts';

const USER_TOKEN_TTL = 3300; // 55 min
const DISCOVERED_TOKEN_TTL = 1800; // 30 min

function isAdmin(req: AuthRequest): boolean {
  return roleAtLeast(req.organizationRole, 'ADMIN');
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
// 2. OAuth Callback — exchange code for tokens
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

    // Store long-lived user token in Redis (never sent to frontend)
    await redis.set(`user_token:${organizationId}:${req.userId}`, llData.access_token, USER_TOKEN_TTL);

    res.json({ success: true, organizationId });
  } catch (err) {
    res.status(500).json({ error: 'INTERNAL_ERROR', message: err instanceof Error ? err.message : 'OAuth callback failed' });
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

    const userToken = await redis.get(`user_token:${req.organizationId}:${req.userId}`);
    if (!userToken) {
      return res.status(400).json({ error: 'FACEBOOK_OAUTH_STATE_EXPIRED', message: 'No valid Facebook session. Please reconnect via OAuth.' });
    }

    const pagesRes = await fetch(
      `${FB_GRAPH}/me/accounts?fields=id,name,access_token,picture,category&access_token=${encodeURIComponent(userToken)}`
    );
    const pagesData = await pagesRes.json() as {
      data?: Array<{ id: string; name: string; access_token: string; picture?: { data?: { url?: string } }; category?: string }>;
      error?: { message: string; code?: number };
    };

    if (pagesData.error || !pagesData.data) {
      const msg = pagesData.error?.message || '';
      if (pagesData.error?.code === 190) {
        return res.status(400).json({ error: 'FACEBOOK_TOKEN_EXCHANGE_FAILED', message: 'Facebook token expired. Please reconnect.' });
      }
      if (msg.includes('permission')) {
        return res.status(400).json({ error: 'FACEBOOK_PERMISSION_INSUFFICIENT', message: msg });
      }
      return res.status(400).json({ error: 'FACEBOOK_TOKEN_EXCHANGE_FAILED', message: msg || 'Failed to fetch pages.' });
    }

    // Check which pages are already imported
    const externalIds = pagesData.data.map(p => p.id);
    const existingPages = await prisma.page.findMany({
      where: { platform: 'FACEBOOK', externalId: { in: externalIds }, isActive: true },
      select: { externalId: true, organizationId: true },
    });
    const importedMap = new Map(existingPages.map(p => [p.externalId, p.organizationId]));

    // Store page tokens in Redis for import step (never sent to frontend)
    for (const p of pagesData.data) {
      await redis.set(`discovered_page:${req.organizationId}:${p.id}`, p.access_token, DISCOVERED_TOKEN_TTL);
    }

    const pages = pagesData.data.map(p => ({
      facebookPageId: p.id,
      name: p.name,
      pictureUrl: p.picture?.data?.url || null,
      category: p.category || null,
      alreadyImported: importedMap.get(p.id) === req.organizationId,
      ownedByOtherOrg: importedMap.has(p.id) && importedMap.get(p.id) !== req.organizationId,
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

      // Check cross-org ownership
      const existingOther = await prisma.page.findFirst({
        where: { platform: 'FACEBOOK', externalId: fbPageId, isActive: true, organizationId: { not: req.organizationId } },
      });
      if (existingOther) {
        results.push({ facebookPageId: fbPageId, status: 'error', error: 'FACEBOOK_PAGE_OWNED_BY_OTHER_ORGANIZATION' });
        continue;
      }

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
