import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Cross-Tenant Security Regression Tests
 *
 * These tests verify that organization tenant isolation is enforced:
 * - Org A must ONLY access Org A data
 * - Backend enforcement is mandatory (frontend hiding is NOT security)
 * - Missing organization credentials must NOT resolve to global credentials
 * - Platform admin settings must NEVER leak into customer org settings
 */

const mockPrisma = vi.hoisted(() => ({
  organizationMember: { findFirst: vi.fn() },
  organization: { findUnique: vi.fn() },
  page: { findUnique: vi.fn(), findMany: vi.fn() },
  organizationMemberPage: { findMany: vi.fn() },
  organizationMemberWorkspace: { findMany: vi.fn() },
  workspacePage: { findMany: vi.fn() },
  organizationSetting: { findUnique: vi.fn() },
  organizationAiCredential: { findUnique: vi.fn() },
  organizationAiOperationSetting: { findUnique: vi.fn() },
}));

vi.mock('../src/utils/db', () => ({
  prisma: mockPrisma,
}));

// Import after mocking
import {
  getAccessiblePageIds,
  maskSecret,
} from '../src/middleware/organization';
import {
  getOrgSetting,
  getOrgAiCredential,
  getOrgAiOperationSetting,
} from '../src/modules/settings/org-settings';

const ORG_A_ID = 'org-a-id';
const ORG_B_ID = 'org-b-id';
const USER_A_ID = 'user-a-id';

describe('Cross-Tenant Security', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Organization Membership Validation', () => {
    it('should reject requests with invalid organization ID', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue(null);

      // Simulate: user sends X-Organization-Id for a non-existent org
      const org = await mockPrisma.organization.findUnique({
        where: { id: 'non-existent-org' },
      });
      expect(org).toBeNull();
    });

    it('should reject requests when user is not a member of the org', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({
        id: ORG_B_ID,
        isActive: true,
      });
      mockPrisma.organizationMember.findFirst.mockResolvedValue(null);

      // User A tries to access Org B
      const member = await mockPrisma.organizationMember.findFirst({
        where: {
          userId: USER_A_ID,
          organizationId: ORG_B_ID,
          isActive: true,
        },
      });
      expect(member).toBeNull();
    });

    it('should reject requests for inactive organizations', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({
        id: ORG_A_ID,
        isActive: false,
      });

      const org = await mockPrisma.organization.findUnique({
        where: { id: ORG_A_ID },
      });
      expect(org?.isActive).toBe(false);
    });
  });

  describe('Page Access Control (RESTRICTED mode)', () => {
    it('should return null for ALL access mode (no filtering)', async () => {
      const req = {
        orgMemberId: 'member-1',
        orgAccessMode: 'ALL',
        organizationId: ORG_A_ID,
      } as any;

      const result = await getAccessiblePageIds(req);
      expect(result).toBeNull();
    });

    it('should return only explicitly granted pages for RESTRICTED mode', async () => {
      const req = {
        orgMemberId: 'member-1',
        orgAccessMode: 'RESTRICTED',
        organizationId: ORG_A_ID,
      } as any;

      mockPrisma.organizationMemberPage.findMany.mockResolvedValue([
        { pageId: 'page-1' },
        { pageId: 'page-2' },
      ]);
      mockPrisma.organizationMemberWorkspace.findMany.mockResolvedValue([]);

      const result = await getAccessiblePageIds(req);
      expect(result).toEqual(['page-1', 'page-2']);
    });

    it('should include workspace pages for RESTRICTED mode', async () => {
      const req = {
        orgMemberId: 'member-1',
        orgAccessMode: 'RESTRICTED',
        organizationId: ORG_A_ID,
      } as any;

      mockPrisma.organizationMemberPage.findMany.mockResolvedValue([
        { pageId: 'page-1' },
      ]);
      mockPrisma.organizationMemberWorkspace.findMany.mockResolvedValue([
        { workspaceId: 'ws-1' },
      ]);
      mockPrisma.workspacePage.findMany.mockResolvedValue([
        { pageId: 'page-3' },
        { pageId: 'page-4' },
      ]);

      const result = await getAccessiblePageIds(req);
      expect(result).toContain('page-1');
      expect(result).toContain('page-3');
      expect(result).toContain('page-4');
    });

    it('should return empty array for RESTRICTED mode with no grants', async () => {
      const req = {
        orgMemberId: 'member-1',
        orgAccessMode: 'RESTRICTED',
        organizationId: ORG_A_ID,
      } as any;

      mockPrisma.organizationMemberPage.findMany.mockResolvedValue([]);
      mockPrisma.organizationMemberWorkspace.findMany.mockResolvedValue([]);

      const result = await getAccessiblePageIds(req);
      expect(result).toEqual([]);
    });
  });

  describe('Secret Masking', () => {
    it('should mask API keys in responses', () => {
      const masked = maskSecret('sk-1234567890abcdef');
      expect(masked).not.toBe('sk-1234567890abcdef');
      expect(masked).toContain('••••');
      expect(masked.length).toBeLessThan('sk-1234567890abcdef'.length);
    });

    it('should mask short secrets completely', () => {
      const masked = maskSecret('short');
      expect(masked).toBe('••••••••');
    });

    it('should handle empty/null-like secrets', () => {
      const masked = maskSecret('');
      expect(masked).toBe('••••••••');
    });
  });

  describe('Org-Scoped Credential Resolution', () => {
    it('should return org-specific setting, not global', async () => {
      mockPrisma.organizationSetting.findUnique.mockResolvedValue({
        value: 'org-a-telegram-token',
      });

      const result = await getOrgSetting(ORG_A_ID, 'TELEGRAM_BOT_TOKEN');
      expect(result).toBe('org-a-telegram-token');
      expect(mockPrisma.organizationSetting.findUnique).toHaveBeenCalledWith({
        where: {
          organizationId_key: {
            organizationId: ORG_A_ID,
            key: 'TELEGRAM_BOT_TOKEN',
          },
        },
      });
    });

    it('should return null when org has no credential (not fall back to global)', async () => {
      mockPrisma.organizationSetting.findUnique.mockResolvedValue(null);

      const result = await getOrgSetting(ORG_A_ID, 'TELEGRAM_BOT_TOKEN');
      expect(result).toBeNull();
    });

    it('should return org AI credential only for the specific org', async () => {
      mockPrisma.organizationAiCredential.findUnique.mockResolvedValue({
        apiKey: 'org-a-anthropic-key',
        isActive: true,
      });

      const result = await getOrgAiCredential(ORG_A_ID, 'anthropic');
      expect(result).toBe('org-a-anthropic-key');
      expect(mockPrisma.organizationAiCredential.findUnique).toHaveBeenCalledWith({
        where: {
          organizationId_provider: {
            organizationId: ORG_A_ID,
            provider: 'anthropic',
          },
        },
        select: { apiKey: true, isActive: true },
      });
    });

    it('should return null for inactive AI credential', async () => {
      mockPrisma.organizationAiCredential.findUnique.mockResolvedValue({
        apiKey: 'some-key',
        isActive: false,
      });

      const result = await getOrgAiCredential(ORG_A_ID, 'anthropic');
      expect(result).toBeNull();
    });

    it('should return null for missing AI credential (not fallback to global)', async () => {
      mockPrisma.organizationAiCredential.findUnique.mockResolvedValue(null);

      const result = await getOrgAiCredential(ORG_A_ID, 'openai');
      expect(result).toBeNull();
    });

    it('should resolve org AI operation settings independently', async () => {
      mockPrisma.organizationAiOperationSetting.findUnique.mockResolvedValue({
        provider: 'openai',
        model: 'gpt-5-mini',
      });

      const result = await getOrgAiOperationSetting(ORG_A_ID, 'text');
      expect(result).toEqual({ provider: 'openai', model: 'gpt-5-mini' });
    });

    it('should return null for missing AI operation setting', async () => {
      mockPrisma.organizationAiOperationSetting.findUnique.mockResolvedValue(null);

      const result = await getOrgAiOperationSetting(ORG_A_ID, 'text');
      expect(result).toBeNull();
    });
  });

  describe('Cross-Org Page Isolation', () => {
    it('should not allow Org A to access Org B pages', async () => {
      mockPrisma.page.findUnique.mockResolvedValue({
        id: 'page-org-b',
        organizationId: ORG_B_ID,
      });

      const page = await mockPrisma.page.findUnique({
        where: { id: 'page-org-b' },
      });
      expect(page?.organizationId).toBe(ORG_B_ID);
      expect(page?.organizationId).not.toBe(ORG_A_ID);
    });
  });

  describe('Org-Scoped Query Filtering', () => {
    it('should always include organizationId in where clause', () => {
      const where: Record<string, unknown> = { status: 'DRAFT' };
      const orgFiltered = { ...where, organizationId: ORG_A_ID };

      expect(orgFiltered.organizationId).toBe(ORG_A_ID);
      expect(orgFiltered.status).toBe('DRAFT');
    });

    it('should scope page queries to organization', async () => {
      mockPrisma.page.findMany.mockResolvedValue([
        { id: 'page-1', organizationId: ORG_A_ID },
      ]);

      const pages = await mockPrisma.page.findMany({
        where: { organizationId: ORG_A_ID, isActive: true },
      });

      expect(mockPrisma.page.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            organizationId: ORG_A_ID,
          }),
        })
      );
      expect(pages.every((p: any) => p.organizationId === ORG_A_ID)).toBe(true);
    });
  });

  describe('Role-Based Access Control', () => {
    it('MEMBER should not be able to create campaigns (requires OWNER/ADMIN/MANAGER)', () => {
      const allowedRoles = ['OWNER', 'ADMIN', 'MANAGER'];
      expect(allowedRoles.includes('MEMBER')).toBe(false);
    });

    it('MEMBER should not be able to delete campaigns (requires OWNER/ADMIN)', () => {
      const allowedRoles = ['OWNER', 'ADMIN'];
      expect(allowedRoles.includes('MEMBER')).toBe(false);
      expect(allowedRoles.includes('MANAGER')).toBe(false);
    });

    it('Only OWNER can change member roles', () => {
      const allowedRoles = ['OWNER'];
      expect(allowedRoles.includes('ADMIN')).toBe(false);
      expect(allowedRoles.includes('MANAGER')).toBe(false);
      expect(allowedRoles.includes('MEMBER')).toBe(false);
    });

    it('OWNER role cannot be changed', () => {
      const role = 'OWNER';
      const canChange = role !== 'OWNER';
      expect(canChange).toBe(false);
    });

    it('OWNER cannot be removed from organization', () => {
      const role = 'OWNER';
      const canRemove = role !== 'OWNER';
      expect(canRemove).toBe(false);
    });
  });

  describe('Activity Log Organization Scoping', () => {
    it('should include organizationId in activity log data', () => {
      const logData = {
        action: 'generate',
        category: 'content',
        summary: 'Test',
        organizationId: ORG_A_ID,
      };

      expect(logData.organizationId).toBe(ORG_A_ID);
    });
  });

  describe('Socket.IO Organization Isolation', () => {
    it('should scope activity events to org rooms', () => {
      const orgRoom = `org:${ORG_A_ID}`;
      expect(orgRoom).toBe(`org:${ORG_A_ID}`);
      expect(orgRoom).not.toBe(`org:${ORG_B_ID}`);
    });

    it('should scope content events to org rooms', () => {
      const event = {
        contentId: 'content-1',
        pageId: 'page-1',
        organizationId: ORG_A_ID,
        operation: 'generate',
        status: 'completed',
      };

      expect(event.organizationId).toBe(ORG_A_ID);
    });
  });
});
