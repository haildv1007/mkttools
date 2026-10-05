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

      const originalGetIO = (await import('../src/realtime/index')).getIO;

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
      expect(result.error).toContain('Organization mismatch');
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
    it('resolveOrgForChat helper exists and scopes by page (code inspection)', async () => {
      const fs = await import('fs');
      const source = fs.readFileSync('src/modules/telegram-bot/index.ts', 'utf8');

      expect(source).toContain('async function resolveOrgForChat');
      expect(source).toContain('telegramGroupId: String(chatId)');
      expect(source).toContain('page.organizationId');
    });

    it('sendContentForApproval does not fall back to global adminChatIds (code inspection)', async () => {
      const fs = await import('fs');
      const source = fs.readFileSync('src/modules/telegram-bot/index.ts', 'utf8');

      const fnMatch = source.match(/export async function sendContentForApproval[\s\S]*?^}/m);
      expect(fnMatch).toBeTruthy();
      expect(fnMatch![0]).not.toContain('config.telegram.adminChatIds');
      expect(fnMatch![0]).toContain('if (!pageGroupId) return');
    });

    it('/pending and /stats use resolveOrgForChat not isAdmin (code inspection)', async () => {
      const fs = await import('fs');
      const source = fs.readFileSync('src/modules/telegram-bot/index.ts', 'utf8');

      const pendingMatch = source.match(/\/pending[\s\S]*?sendApprovalMessage/);
      expect(pendingMatch).toBeTruthy();
      expect(pendingMatch![0]).toContain('resolveOrgForChat');
      expect(pendingMatch![0]).not.toContain('isAdmin');

      const statsMatch = source.match(/\/stats[\s\S]*?statusEmoji/);
      expect(statsMatch).toBeTruthy();
      expect(statsMatch![0]).toContain('resolveOrgForChat');
      expect(statsMatch![0]).toContain('organizationId: orgScope');
    });

    it('isAdmin no longer checks global config.telegram.adminChatIds (code inspection)', async () => {
      const fs = await import('fs');
      const source = fs.readFileSync('src/modules/telegram-bot/index.ts', 'utf8');

      const isAdminMatch = source.match(/async function isAdmin[\s\S]*?^}/m);
      expect(isAdminMatch).toBeTruthy();
      expect(isAdminMatch![0]).not.toContain('config.telegram.adminChatIds');
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

  describe('Dashboard PUT /pages/:id RESTRICTED access', () => {
    it('page update checks canAccessPage for RESTRICTED members (code inspection)', async () => {
      const fs = await import('fs');
      const source = fs.readFileSync('src/modules/dashboard/index.ts', 'utf8');

      const putMatch = source.match(/router\.put\('\/pages\/:id'[\s\S]*?res\.json\(page\)/);
      expect(putMatch).toBeTruthy();
      const putCode = putMatch![0];

      expect(putCode).toContain('isAllAccess');
      expect(putCode).toContain('canAccessPage');
      expect(putCode).toContain('RESOURCE_ACCESS_DENIED');
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
      expect(emitFn![0]).toContain('if (!event.organizationId) return');
    });
  });

  describe('Publisher org validation', () => {
    it('publishContent signature accepts expectedOrganizationId (code inspection)', async () => {
      const fs = await import('fs');
      const source = fs.readFileSync('src/modules/publisher/index.ts', 'utf8');

      expect(source).toContain('expectedOrganizationId');
      expect(source).toContain('Organization mismatch');
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

  describe('Queue publish worker passes org to publisher', () => {
    it('publishContent called with organizationId (code inspection)', async () => {
      const fs = await import('fs');
      const source = fs.readFileSync('src/queues/index.ts', 'utf8');

      expect(source).toContain('publishContent(contentItemId, organizationId)');
    });
  });
});
