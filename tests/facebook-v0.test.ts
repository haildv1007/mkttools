import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';

const mockPrisma = vi.hoisted(() => ({
  page: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  organizationMember: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
  },
  organizationSetting: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
  },
  contentItem: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock('../src/utils/db', () => ({ prisma: mockPrisma }));

describe('Facebook V0 Backend', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // ============================================================
  // 1. Page access token encryption
  // ============================================================
  describe('Page access token encryption', () => {
    it('encryptPageToken produces prefixed ciphertext, decryptPageToken recovers plaintext', async () => {
      const { encryptPageToken, decryptPageToken } = await import('../src/utils/crypto');
      const plain = 'EAABwzLixnjYBO1234567890abcdef';
      const encrypted = encryptPageToken(plain);
      expect(encrypted).toBeTruthy();
      expect(encrypted).not.toBe(plain);
      expect(encrypted.startsWith('ptgcm1:')).toBe(true);
      const decrypted = decryptPageToken(encrypted);
      expect(decrypted).toBe(plain);
    });

    it('decryptPageToken handles legacy plaintext (backwards compat)', async () => {
      const { decryptPageToken } = await import('../src/utils/crypto');
      const legacy = 'EAABwzLixnjYBOlegacyplaintext';
      expect(decryptPageToken(legacy)).toBe(legacy);
    });

    it('import endpoint stores encrypted token, not plaintext (code inspection)', () => {
      const source = fs.readFileSync('src/modules/facebook/index.ts', 'utf8');
      expect(source).toContain('encryptPageToken(pageToken)');
      expect(source).toContain("accessToken: encryptedToken");
    });

    it('publisher decrypts page token server-side before calling Facebook API', () => {
      const source = fs.readFileSync('src/modules/publisher/index.ts', 'utf8');
      expect(source).toContain('decryptPageToken');
      expect(source).toContain('decryptPageToken(item.page.accessToken)');
    });

    it('dashboard decrypts page tokens for insights/metrics calls', () => {
      const source = fs.readFileSync('src/modules/dashboard/index.ts', 'utf8');
      expect(source).toContain('decryptPageToken(page.accessToken)');
      expect(source).toContain('decryptPageToken(item.page.accessToken)');
    });

    it('dashboard encrypts tokens on page create and update', () => {
      const source = fs.readFileSync('src/modules/dashboard/index.ts', 'utf8');
      expect(source).toContain("encryptPageToken(accessToken)");
      expect(source).toContain("safeBody.accessToken = encryptPageToken(safeBody.accessToken)");
    });
  });

  // ============================================================
  // 2. OAuth state via Redis
  // ============================================================
  describe('OAuth state uses Redis (code inspection)', () => {
    it('oauth-state.ts uses Redis, not in-memory Map', () => {
      const source = fs.readFileSync('src/modules/facebook/oauth-state.ts', 'utf8');
      expect(source).toContain("redis.set");
      expect(source).toContain("redis.getAndDelete");
      expect(source).not.toContain('new Map');
      expect(source).not.toContain('setInterval');
    });

    it('oauth-state binds redirectUri into state', () => {
      const source = fs.readFileSync('src/modules/facebook/oauth-state.ts', 'utf8');
      expect(source).toContain('redirectUri');
      const createFn = source.match(/export async function createOAuthState\([^)]+\)/);
      expect(createFn).toBeTruthy();
      expect(createFn![0]).toContain('redirectUri: string');
    });

    it('facebook/index.ts uses Redis for user tokens and discovered page tokens', () => {
      const source = fs.readFileSync('src/modules/facebook/index.ts', 'utf8');
      expect(source).toContain("redis.set(`user_token:");
      expect(source).toContain("redis.get(`user_token:");
      expect(source).toContain("redis.set(`discovered_page:");
      expect(source).toContain("redis.get(`discovered_page:");
      expect(source).toContain("redis.del(`discovered_page:");
      // No in-memory Map for tokens/state (importedMap is fine - it's ephemeral per-request)
      expect(source).not.toMatch(/const (userTokenStore|discoveredPageTokens|stateStore)\s*=\s*new Map/);
      expect(source).not.toContain('setInterval');
    });
  });

  // ============================================================
  // 3. Redirect URI validation
  // ============================================================
  describe('Redirect URI validation', () => {
    it('isAllowedRedirectUri allows localhost variants', async () => {
      const { isAllowedRedirectUri } = await import('../src/modules/facebook/config');
      expect(isAllowedRedirectUri('http://localhost:3000/callback')).toBe(true);
      expect(isAllowedRedirectUri('http://127.0.0.1:3000/callback')).toBe(true);
      expect(isAllowedRedirectUri('https://localhost/callback')).toBe(true);
    });

    it('isAllowedRedirectUri rejects unknown external URLs', async () => {
      const { isAllowedRedirectUri } = await import('../src/modules/facebook/config');
      expect(isAllowedRedirectUri('https://evil.com/callback')).toBe(false);
      expect(isAllowedRedirectUri('https://attacker.example.com/steal')).toBe(false);
    });

    it('oauth/start validates redirectUri before proceeding (code inspection)', () => {
      const source = fs.readFileSync('src/modules/facebook/index.ts', 'utf8');
      const startMatch = source.match(/router\.post\('\/oauth\/start'[\s\S]*?res\.json\(\{ oauthUrl/);
      expect(startMatch).toBeTruthy();
      expect(startMatch![0]).toContain('isAllowedRedirectUri');
      expect(startMatch![0]).toContain('FACEBOOK_REDIRECT_URI_NOT_ALLOWED');
    });

    it('oauth/callback uses trusted redirectUri from state, rejects mismatch', () => {
      const source = fs.readFileSync('src/modules/facebook/index.ts', 'utf8');
      const cbMatch = source.match(/router\.post\('\/oauth\/callback'[\s\S]*?res\.json\(\{ success/);
      expect(cbMatch).toBeTruthy();
      expect(cbMatch![0]).toContain('bag.redirectUri');
      expect(cbMatch![0]).toContain('FACEBOOK_REDIRECT_URI_MISMATCH');
      expect(cbMatch![0]).toContain('trustedRedirectUri');
    });

    it('callback uses org from state, not X-Organization-Id header', () => {
      const source = fs.readFileSync('src/modules/facebook/index.ts', 'utf8');
      const cbMatch = source.match(/router\.post\('\/oauth\/callback'[\s\S]*?res\.json\(\{ success/);
      expect(cbMatch).toBeTruthy();
      expect(cbMatch![0]).toContain('const organizationId = bag.organizationId');
      expect(cbMatch![0]).not.toMatch(/req\.organizationId.*findFirst/);
    });
  });

  // ============================================================
  // Preserved: existing security checks
  // ============================================================
  describe('Page tokens are never returned in API responses (code inspection)', () => {
    it('manual token flow stores the exchanged token encrypted and in Redis, and returns no token', () => {
      const source = fs.readFileSync('src/modules/facebook/index.ts', 'utf8');
      const route = source.match(/router\.post\('\/token\/connect'[\s\S]*?res\.json\(\{ success: true \}\)/);
      expect(route).toBeTruthy();
      expect(route![0]).toContain('redis.set(`user_token:');
      expect(route![0]).toContain('FACEBOOK_USER_ACCESS_TOKEN');
      expect(route![0]).not.toMatch(/res\.json\([^)]*access_token/);
    });

    it('manual token UI sends the token only to the server bridge', () => {
      const js = fs.readFileSync('public/js/pages/pages.js', 'utf8');
      const html = fs.readFileSync('public/pages/pages.html', 'utf8');
      expect(js).toContain("facebookApi('/token/connect'");
      expect(js).toContain('await this.discoverFacebookPages(true)');
      expect(html).toContain('Lấy Pages đã lưu');
    });

    it('existing same-organization Pages can be selected to refresh their token', () => {
      const js = fs.readFileSync('public/js/pages/pages.js', 'utf8');
      const selectable = js.substring(js.indexOf('isFacebookPageSelectable('), js.indexOf('facebookPageStateLabel('));
      expect(selectable).toContain('return !page.ownedByOtherOrg');
      expect(selectable).not.toContain('!page.alreadyImported');
      expect(js).toContain('page.alreadyImported && !page.ownedByOtherOrg');
      expect(js).toContain('await this.discoverFacebookPages(true)');
    });

    it('discover endpoint returns only safe metadata, never access_token', () => {
      const source = fs.readFileSync('src/modules/facebook/index.ts', 'utf8');
      const discoverMatch = source.match(/router\.get\('\/pages\/discover'[\s\S]*?res\.json\(\{ pages \}\)/);
      expect(discoverMatch).toBeTruthy();
      const mapBody = discoverMatch![0].match(/\.map\(p => \(\{[\s\S]*?\}\)\)/);
      expect(mapBody).toBeTruthy();
      expect(mapBody![0]).not.toMatch(/access_token/);
    });

    it('page status endpoint never returns accessToken value', () => {
      const source = fs.readFileSync('src/modules/facebook/index.ts', 'utf8');
      expect(source).toContain('connected: p.isActive && !!p.accessToken');
    });
  });

  describe('Import security (code inspection)', () => {
    it('import validates page IDs came from discovery flow (Redis), not arbitrary tokens', () => {
      const source = fs.readFileSync('src/modules/facebook/index.ts', 'utf8');
      const importMatch = source.match(/router\.post\('\/pages\/import'[\s\S]*?res\.json\(\{ results \}\)/);
      expect(importMatch).toBeTruthy();
      expect(importMatch![0]).toContain('redis.get(`discovered_page:');
      expect(importMatch![0]).toContain('FACEBOOK_PAGE_NOT_FOUND');
      expect(importMatch![0]).not.toContain('req.body.accessToken');
    });

    it('import rejects pages owned by another organization', () => {
      const source = fs.readFileSync('src/modules/facebook/index.ts', 'utf8');
      expect(source).toContain('FACEBOOK_PAGE_OWNED_BY_OTHER_ORGANIZATION');
    });
  });

  describe('OAuth flow requires admin role (code inspection)', () => {
    it('oauth/start requires ADMIN role', () => {
      const source = fs.readFileSync('src/modules/facebook/index.ts', 'utf8');
      const startMatch = source.match(/router\.post\('\/oauth\/start'[\s\S]*?res\.json\(\{ oauthUrl/);
      expect(startMatch).toBeTruthy();
      expect(startMatch![0]).toContain('isAdmin(req)');
    });

    it('oauth/callback revalidates membership from state', () => {
      const source = fs.readFileSync('src/modules/facebook/index.ts', 'utf8');
      const cbMatch = source.match(/router\.post\('\/oauth\/callback'[\s\S]*?res\.json\(\{ success/);
      expect(cbMatch).toBeTruthy();
      expect(cbMatch![0]).toContain('validateAndConsumeOAuthState');
      expect(cbMatch![0]).toContain('bag.organizationId');
    });
  });

  describe('Publisher loads tokens server-side (existing)', () => {
    it('publishContent resolves page token from DB, not job payload', () => {
      const source = fs.readFileSync('src/modules/publisher/index.ts', 'utf8');
      expect(source).toContain('decryptPageToken(item.page.accessToken)');
      expect(source).toContain('item.page.organizationId !== item.organizationId');
    });

    it('publisher never accepts token from queue job', () => {
      const source = fs.readFileSync('src/modules/publisher/index.ts', 'utf8');
      expect(source).not.toContain('job.data.accessToken');
      expect(source).not.toContain('job.data.token');
    });
  });

  describe('No cross-org/global Facebook token fallback', () => {
    it('publisher does not have global token fallback', () => {
      const source = fs.readFileSync('src/modules/publisher/index.ts', 'utf8');
      expect(source).not.toContain('config.facebook');
      expect(source).not.toContain('process.env.FACEBOOK');
    });

    it('facebook config resolver is org-scoped', () => {
      const source = fs.readFileSync('src/modules/facebook/config.ts', 'utf8');
      expect(source).toContain('organizationId');
      expect(source).toContain('getOrganizationSetting');
    });
  });

  describe('Route mounting and auth chain', () => {
    it('facebook router is mounted with full auth chain', () => {
      const source = fs.readFileSync('src/index.ts', 'utf8');
      expect(source).toContain("app.use('/api/facebook', authMiddleware, attachOrganization, requireOrganization, facebookRouter)");
    });
  });
});
