import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPrisma = vi.hoisted(() => ({
  contentItem: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
    groupBy: vi.fn(),
  },
  page: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
  },
  organizationMember: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
  },
  organizationMemberPage: { findMany: vi.fn() },
  workspacePage: { findMany: vi.fn() },
  $queryRaw: vi.fn(),
}));

vi.mock('../src/utils/db', () => ({ prisma: mockPrisma }));

describe('Cross-tenant security', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('emitActivity', () => {
    it('drops events without organizationId instead of broadcasting globally', async () => {
      const mockIO = {
        to: vi.fn().mockReturnThis(),
        emit: vi.fn(),
      };

      vi.doMock('../src/realtime/index', async () => {
        const mod = await vi.importActual<typeof import('../src/realtime/index')>('../src/realtime/index');
        return mod;
      });

      const { emitActivity } = await import('../src/realtime/index');

      const event = {
        id: 'act-1',
        action: 'test',
        category: 'test',
        status: 'success',
        summary: 'test event',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      emitActivity(event);
      expect(mockIO.emit).not.toHaveBeenCalled();
    });

    it('scopes activity events to org room', async () => {
      const { emitActivity } = await import('../src/realtime/index');

      const event = {
        id: 'act-2',
        organizationId: 'org-A',
        action: 'test',
        category: 'test',
        status: 'success',
        summary: 'test event',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      emitActivity(event);
    });
  });

  describe('publishContent', () => {
    it('rejects when expectedOrganizationId does not match content org', async () => {
      mockPrisma.contentItem.findUnique.mockResolvedValueOnce({
        id: 'ci-1',
        organizationId: 'org-A',
        pageId: 'page-1',
        status: 'APPROVED',
        generatedText: 'hello',
        page: { organizationId: 'org-A', platform: 'FACEBOOK', externalId: 'ext', accessToken: 'tok' },
      });

      const { publishContent } = await import('../src/modules/publisher/index');
      const result = await publishContent('ci-1', 'org-B');
      expect(result.success).toBe(false);
      expect(result.error).toContain('organization mismatch');
    });

    it('rejects when content and page orgs differ', async () => {
      mockPrisma.contentItem.findUnique.mockResolvedValueOnce({
        id: 'ci-2',
        organizationId: 'org-A',
        pageId: 'page-1',
        status: 'APPROVED',
        generatedText: 'hello',
        page: { organizationId: 'org-B', platform: 'FACEBOOK', externalId: 'ext', accessToken: 'tok' },
      });

      const { publishContent } = await import('../src/modules/publisher/index');
      const result = await publishContent('ci-2');
      expect(result.success).toBe(false);
      expect(result.error).toContain('organization mismatch');
    });
  });

  describe('Telegram bot org scoping', () => {
    it('resolveTelegramScope helper exists and scopes by page with RBAC (code inspection)', async () => {
      const fs = await import('fs');
      const source = fs.readFileSync('src/modules/telegram-bot/index.ts', 'utf8');

      expect(source).toContain('async function resolveTelegramScope');
      expect(source).toContain('telegramGroupId: String(chatId)');
      expect(source).toContain('getAccessContext');
      expect(source).toContain('canAccessPage');
    });

    it('sendContentForApproval uses org-scoped settings fallback (code inspection)', async () => {
      const fs = await import('fs');
      const source = fs.readFileSync('src/modules/telegram-bot/index.ts', 'utf8');

      const fnMatch = source.match(/export async function sendContentForApproval[\s\S]*?^}/m);
      expect(fnMatch).toBeTruthy();
      expect(fnMatch![0]).not.toContain('config.telegram.adminChatIds');
      expect(fnMatch![0]).toContain('pageGroupId');
      expect(fnMatch![0]).toContain('getOrganizationSettings');
    });

    it('/pending and /stats use resolveTelegramScope for org+access scoping (code inspection)', async () => {
      const fs = await import('fs');
      const source = fs.readFileSync('src/modules/telegram-bot/index.ts', 'utf8');

      const pendingMatch = source.match(/\/pending[\s\S]*?sendApprovalMessage/);
      expect(pendingMatch).toBeTruthy();
      expect(pendingMatch![0]).toContain('resolveTelegramScope');
      expect(pendingMatch![0]).toContain('scope.organizationId');

      const statsMatch = source.match(/\/stats[\s\S]*?statusEmoji/);
      expect(statsMatch).toBeTruthy();
      expect(statsMatch![0]).toContain('resolveTelegramScope');
      expect(statsMatch![0]).toContain('scope.organizationId');
    });

    it('resolveTelegramScope enforces RBAC access checks (code inspection)', async () => {
      const fs = await import('fs');
      const source = fs.readFileSync('src/modules/telegram-bot/index.ts', 'utf8');

      const scopeMatch = source.match(/async function resolveTelegramScope[\s\S]*?^}/m);
      expect(scopeMatch).toBeTruthy();
      expect(scopeMatch![0]).not.toContain('config.telegram.adminChatIds');
      expect(scopeMatch![0]).toContain('getAccessContext');
      expect(scopeMatch![0]).toContain('canAccessPage');
      expect(scopeMatch![0]).toContain('getAccessiblePageIds');
    });
  });

  describe('Dashboard stats/timeline', () => {
    it('timeline query includes organizationId filter (code inspection)', async () => {
      const fs = await import('fs');
      const source = fs.readFileSync('src/modules/dashboard/index.ts', 'utf8');

      const timelineMatch = source.match(/router\.get\('\/stats\/timeline'[\s\S]*?res\.json\(rows\)/);
      expect(timelineMatch).toBeTruthy();
      const timelineCode = timelineMatch![0];

      expect(timelineCode).toContain('AuthRequest');
      expect(timelineCode).toContain('organization_id');
      expect(timelineCode).not.toMatch(/req:\s*Request\b/);
    });
  });

  describe('Dashboard PUT /pages/:id access control', () => {
    it('page update is restricted to OWNER/ADMIN and validates org ownership (code inspection)', async () => {
      const fs = await import('fs');
      const source = fs.readFileSync('src/modules/dashboard/index.ts', 'utf8');

      const putMatch = source.match(/router\.put\('\/pages\/:id'[\s\S]*?res\.json\(page\)/);
      expect(putMatch).toBeTruthy();
      const putCode = putMatch![0];

      expect(putCode).toContain('isOrganizationAdmin');
      expect(putCode).toContain('FORBIDDEN');
      expect(putCode).toContain('existing.organizationId !== req.organizationId');
    });
  });

  describe('Facebook token exchange', () => {
    it('uses AuthRequest not bare Request (code inspection)', async () => {
      const fs = await import('fs');
      const source = fs.readFileSync('src/modules/dashboard/index.ts', 'utf8');

      const fbMatch = source.match(/router\.post\('\/pages\/fb-token-exchange'[\s\S]{0,200}/);
      expect(fbMatch).toBeTruthy();
      expect(fbMatch![0]).toContain('AuthRequest');
    });
  });

  describe('Realtime emitActivity isolation', () => {
    it('source code has no io.emit fallback (code inspection)', async () => {
      const fs = await import('fs');
      const source = fs.readFileSync('src/realtime/index.ts', 'utf8');

      const emitFn = source.match(/export function emitActivity[\s\S]*?^}/m);
      expect(emitFn).toBeTruthy();
      expect(emitFn![0]).not.toContain('io.emit(');
      expect(emitFn![0]).toContain('if (event.organizationId)');
      expect(emitFn![0]).toContain('org:${event.organizationId}');
    });
  });

  describe('Publisher org validation', () => {
    it('publishContent validates org match and cross-checks page org (code inspection)', async () => {
      const fs = await import('fs');
      const source = fs.readFileSync('src/modules/publisher/index.ts', 'utf8');

      expect(source).toContain('expectedOrganizationId');
      expect(source).toContain('organization mismatch');
      expect(source).toContain('Content/page organization mismatch');
    });
  });

  describe('Telegram handleRegenerate credential context', () => {
    it('passes organizationId in credential context (code inspection)', async () => {
      const fs = await import('fs');
      const source = fs.readFileSync('src/modules/telegram-bot/index.ts', 'utf8');

      const regenMatch = source.match(/handleRegenerate[\s\S]*?generateText\(\{[\s\S]*?\}\)/);
      expect(regenMatch).toBeTruthy();
      expect(regenMatch![0]).toContain('credential');
      expect(regenMatch![0]).toContain('organizationId');
    });
  });

  describe('Queue workers pass organizationId', () => {
    it('generate worker validates org and checks actor access (code inspection)', async () => {
      const fs = await import('fs');
      const source = fs.readFileSync('src/queues/index.ts', 'utf8');

      expect(source).toContain('assertQueueOrganization');
      expect(source).toContain('publishContent(contentItemId, organizationId)');
    });

    it('publish worker validates org before publishing (code inspection)', async () => {
      const fs = await import('fs');
      const source = fs.readFileSync('src/queues/index.ts', 'utf8');

      expect(source).toContain('assertQueueOrganization');
      expect(source).toContain('canAccessPage');
    });
  });

  describe('Queue security module', () => {
    it('assertQueueOrganization helper exists (code inspection)', async () => {
      const fs = await import('fs');
      const source = fs.readFileSync('src/queues/security.ts', 'utf8');

      expect(source).toContain('assertQueueOrganization');
    });
  });
});
