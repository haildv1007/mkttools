import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';

const mockPrisma = vi.hoisted(() => ({
  contentItem: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
    count: vi.fn(),
    groupBy: vi.fn(),
  },
  page: { findUnique: vi.fn(), findFirst: vi.fn() },
  organizationMember: { findUnique: vi.fn(), findFirst: vi.fn() },
  organizationMemberPage: { findMany: vi.fn() },
  workspacePage: { findMany: vi.fn() },
  $queryRaw: vi.fn(),
}));

vi.mock('../src/utils/db', () => ({ prisma: mockPrisma }));

describe('Content list optimization', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  describe('Pagination contract', () => {
    it('pageSize is capped at 200 and defaults to 50', () => {
      const source = fs.readFileSync('src/modules/dashboard/index.ts', 'utf8');
      expect(source).toContain('Math.min(Math.max(1, Number(pageSize)), 200)');
    });

    it('response includes pagination object with page, pageSize, total, totalPages', () => {
      const source = fs.readFileSync('src/modules/dashboard/index.ts', 'utf8');
      expect(source).toContain('pagination: { page: currentPage, pageSize: take, total, totalPages:');
    });

    it('uses deterministic sort with id tiebreaker', () => {
      const source = fs.readFileSync('src/modules/dashboard/index.ts', 'utf8');
      expect(source).toMatch(/orderBy:\s*\[\s*\{[^}]+\}\s*,\s*\{\s*id:\s*'asc'\s*\}\s*\]/);
    });
  });

  describe('Lightweight DTO', () => {
    it('uses select instead of include for content list', () => {
      const source = fs.readFileSync('src/modules/dashboard/index.ts', 'utf8');
      expect(source).toContain('select: CONTENT_LIST_SELECT');
    });

    it('CONTENT_LIST_SELECT does not include heavy fields', () => {
      const source = fs.readFileSync('src/modules/dashboard/index.ts', 'utf8');
      const selectMatch = source.match(/const CONTENT_LIST_SELECT\s*=\s*\{([^}]+(?:\{[^}]*\}[^}]*)*)\}/s);
      expect(selectMatch).toBeTruthy();
      const selectBlock = selectMatch![0];
      expect(selectBlock).not.toContain('generatedText');
      expect(selectBlock).not.toContain('generatedImages');
      expect(selectBlock).not.toContain('imageDescriptions');
      expect(selectBlock).not.toContain('notes');
      expect(selectBlock).not.toContain('errorMessage');
      expect(selectBlock).not.toContain('aiModel');
      expect(selectBlock).not.toContain('aiImageModel');
      expect(selectBlock).not.toContain('metrics');
      expect(selectBlock).not.toContain('telegramMsgId');
      expect(selectBlock).not.toContain('socialPostId');
    });

    it('CONTENT_LIST_SELECT includes required list fields', () => {
      const source = fs.readFileSync('src/modules/dashboard/index.ts', 'utf8');
      const selectMatch = source.match(/const CONTENT_LIST_SELECT\s*=\s*\{([^}]+(?:\{[^}]*\}[^}]*)*)\}/s);
      expect(selectMatch).toBeTruthy();
      const selectBlock = selectMatch![0];
      expect(selectBlock).toContain('id: true');
      expect(selectBlock).toContain('topic: true');
      expect(selectBlock).toContain('status: true');
      expect(selectBlock).toContain('source: true');
      expect(selectBlock).toContain('contentType: true');
      expect(selectBlock).toContain('scheduledAt: true');
      expect(selectBlock).toContain('createdAt: true');
      expect(selectBlock).toContain('generatedImageUrl: true');
      expect(selectBlock).toContain('externalId: true');
    });

    it('page avatar has a Facebook icon fallback when the Graph image fails', () => {
      const html = fs.readFileSync('public/pages/content.html', 'utf8');
      expect(html).toContain("item.page.externalId+'/picture?type=small'");
      expect(html).toContain("this.nextElementSibling.style.display='inline-flex'");
      expect(html).toContain('ri-facebook-circle-fill');
    });
  });

  describe('Source normalization', () => {
    it('normalizeSource maps AI to AI_GEN', () => {
      const source = fs.readFileSync('src/modules/dashboard/index.ts', 'utf8');
      expect(source).toContain("return dbSource === 'AI' ? 'AI_GEN' : 'MANUAL'");
    });

    it('normalizeSource maps MANUAL and IMPORT to MANUAL', () => {
      const source = fs.readFileSync('src/modules/dashboard/index.ts', 'utf8');
      expect(source).toContain("return dbSource === 'AI' ? 'AI_GEN' : 'MANUAL'");
    });

    it('source filter AI_GEN maps to DB value AI', () => {
      const source = fs.readFileSync('src/modules/dashboard/index.ts', 'utf8');
      expect(source).toContain("if (v === 'AI_GEN' || v === 'AI') dbValues.push('AI')");
    });

    it('source filter MANUAL maps to both MANUAL and IMPORT DB values', () => {
      const source = fs.readFileSync('src/modules/dashboard/index.ts', 'utf8');
      expect(source).toContain("else if (v === 'MANUAL') { dbValues.push('MANUAL'); dbValues.push('IMPORT');");
    });

    it('IMPORT is not exposed as a customer-facing source filter', () => {
      const html = fs.readFileSync('public/pages/content.html', 'utf8');
      expect(html).not.toContain("source='IMPORT'");
      expect(html).toContain("source='AI_GEN'");
      expect(html).toContain("source='MANUAL'");
    });

    it('response items use normalized source values', () => {
      const source = fs.readFileSync('src/modules/dashboard/index.ts', 'utf8');
      expect(source).toContain('source: normalizeSource(item.source)');
    });
  });

  describe('Status counts', () => {
    it('status counts use baseWhere (without status filter) for tab counts', () => {
      const source = fs.readFileSync('src/modules/dashboard/index.ts', 'utf8');
      expect(source).toContain("groupBy({ by: ['status'], where: baseWhere, _count: true })");
    });

    it('ALL_CONTENT_STATUSES includes QUEUED', () => {
      const source = fs.readFileSync('src/modules/dashboard/index.ts', 'utf8');
      expect(source).toMatch(/ALL_CONTENT_STATUSES\s*=\s*\[[\s\S]*?'QUEUED'[\s\S]*?\]/);
    });

    it('status counts include ALL total', () => {
      const source = fs.readFileSync('src/modules/dashboard/index.ts', 'utf8');
      expect(source).toContain("statusCounts.ALL = allCount");
    });
  });

  describe('Tenant + access security', () => {
    it('content list always filters by organizationId', () => {
      const source = fs.readFileSync('src/modules/dashboard/index.ts', 'utf8');
      const contentRoute = source.substring(source.indexOf("router.get('/content'"));
      expect(contentRoute).toContain('organizationId: req.organizationId');
    });

    it('restricted members get page-level access filtering', () => {
      const source = fs.readFileSync('src/modules/dashboard/index.ts', 'utf8');
      expect(source).toContain('getAccessContext');
      expect(source).toContain('getAccessiblePageIds');
      expect(source).toContain('accessCtx && !accessCtx.isAllAccess');
    });

    it('page filter is intersected with accessible pages for restricted members', () => {
      const source = fs.readFileSync('src/modules/dashboard/index.ts', 'utf8');
      expect(source).toContain("allowed = allowed.filter((pid) => accessible.includes(pid))");
    });
  });

  describe('DB indexes', () => {
    it('has composite index for organizationId + scheduledAt', () => {
      const schema = fs.readFileSync('prisma/schema.prisma', 'utf8');
      expect(schema).toContain('@@index([organizationId, scheduledAt])');
    });

    it('has composite index for organizationId + pageId + status', () => {
      const schema = fs.readFileSync('prisma/schema.prisma', 'utf8');
      expect(schema).toContain('@@index([organizationId, pageId, status])');
    });

    it('has index on campaignId', () => {
      const schema = fs.readFileSync('prisma/schema.prisma', 'utf8');
      expect(schema).toContain('@@index([campaignId])');
    });

    it('has index on source', () => {
      const schema = fs.readFileSync('prisma/schema.prisma', 'utf8');
      expect(schema).toContain('@@index([source])');
    });
  });

  describe('Media / thumbnail', () => {
    it('list response includes thumbnailUrl computed via getThumbnailUrl', () => {
      const source = fs.readFileSync('src/modules/dashboard/index.ts', 'utf8');
      expect(source).toContain('getThumbnailUrl(item.generatedImageUrl)');
    });

    it('list does not return generatedImages JSON array', () => {
      const source = fs.readFileSync('src/modules/dashboard/index.ts', 'utf8');
      const selectMatch = source.match(/const CONTENT_LIST_SELECT\s*=\s*\{([^}]+(?:\{[^}]*\}[^}]*)*)\}/s);
      expect(selectMatch).toBeTruthy();
      expect(selectMatch![0]).not.toContain('generatedImages');
    });
  });

  describe('Dev observability', () => {
    it('sets X-Query-Time-Ms header in non-production', () => {
      const source = fs.readFileSync('src/modules/dashboard/index.ts', 'utf8');
      expect(source).toContain("res.setHeader('X-Query-Time-Ms'");
      expect(source).toContain("process.env.NODE_ENV !== 'production'");
    });
  });

  describe('Frontend performance', () => {
    it('hydrates a lightweight row before opening the edit form', () => {
      const js = fs.readFileSync('public/js/pages/content.js', 'utf8');
      const editBlock = js.substring(js.indexOf('async editContent('), js.indexOf('async saveContent()'));
      expect(editBlock).toContain("hasOwnProperty.call(item, 'generatedText')");
      expect(editBlock).toContain('`/dashboard/content/${item.id}`');
      expect(editBlock).toContain("!['AI', 'AI_GEN'].includes(item.source)");
    });

    it('bulk publish does not inspect generatedText omitted by the list DTO', () => {
      const js = fs.readFileSync('public/js/pages/content.js', 'utf8');
      const publishBlock = js.substring(js.indexOf('async bulkPublish()'), js.indexOf('async bulkDelete()'));
      expect(publishBlock).not.toContain('i.generatedText');
      expect(publishBlock).toContain("['APPROVED', 'FAILED'].includes(i.status)");
    });

    it('bulk regenerate supports manual and AI items in eligible statuses', () => {
      const js = fs.readFileSync('public/js/pages/content.js', 'utf8');
      const regenerateBlock = js.substring(js.indexOf('async bulkRegenerate()'), js.indexOf('async bulkGenerate()'));
      expect(regenerateBlock).not.toContain("i.source === 'AI_GEN'");
      expect(regenerateBlock).toContain("'APPROVED'");
      expect(regenerateBlock).toContain("'FAILED'");
    });

    it('uses IntersectionObserver for lazy thumbnail loading', () => {
      const js = fs.readFileSync('public/js/pages/content.js', 'utf8');
      expect(js).toContain('IntersectionObserver');
      expect(js).toContain('data-src');
    });

    it('thumbnail images use data-src with thumbnailUrl only', () => {
      const html = fs.readFileSync('public/pages/content.html', 'utf8');
      expect(html).toContain(':data-src="item.thumbnailUrl"');
    });

    it('thumbnails have fixed dimensions to prevent layout shift', () => {
      const html = fs.readFileSync('public/pages/content.html', 'utf8');
      const thumbIdx = html.indexOf("col.key==='thumbnail'");
      const topicIdx = html.indexOf("col.key==='topic'");
      const thumbSection = html.substring(thumbIdx, topicIdx);
      expect(thumbSection).toContain("width:");
      expect(thumbSection).toContain("height:");
    });

    it('uses AbortController to cancel stale content list requests', () => {
      const js = fs.readFileSync('public/js/pages/content.js', 'utf8');
      expect(js).toContain('AbortController');
      expect(js).toContain('_contentAbort');
      expect(js).toContain('signal: ac.signal');
    });

    it('aborts previous request before starting new one', () => {
      const js = fs.readFileSync('public/js/pages/content.js', 'utf8');
      const loadContent = js.substring(js.indexOf('async loadContent()'));
      expect(loadContent).toContain('if (this._contentAbort) this._contentAbort.abort()');
    });

    it('ignores AbortError exceptions', () => {
      const js = fs.readFileSync('public/js/pages/content.js', 'utf8');
      expect(js).toContain("e?.name === 'AbortError'");
    });

    it('search input uses 300ms debounce', () => {
      const html = fs.readFileSync('public/pages/content.html', 'utf8');
      expect(html).toContain('@input.debounce.300ms');
    });

    it('shows skeleton rows during initial content load', () => {
      const html = fs.readFileSync('public/pages/content.html', 'utf8');
      expect(html).toContain('contentLoading && contentItems.length === 0');
      expect(html).toContain('animate-pulse');
    });

    it('dims existing content during filter/page changes', () => {
      const html = fs.readFileSync('public/pages/content.html', 'utf8');
      expect(html).toContain("contentLoading && contentItems.length > 0 && 'opacity-60");
    });

    it('disconnects observers when navigating away from content', () => {
      const nav = fs.readFileSync('public/js/navigation.js', 'utf8');
      expect(nav).toContain('destroyContentPerf');
      const js = fs.readFileSync('public/js/pages/content.js', 'utf8');
      expect(js).toContain('_thumbObserver.disconnect()');
    });

    it('source dropdown shows only AI Gen and Thủ công', () => {
      const html = fs.readFileSync('public/pages/content.html', 'utf8');
      expect(html).toContain('AI Gen');
      expect(html).toContain('Thủ công');
      expect(html).not.toContain('value="IMPORT"');
    });

    it('sourceLabel handles both normalized and raw source values', () => {
      const js = fs.readFileSync('public/js/pages/content.js', 'utf8');
      expect(js).toContain("AI_GEN: 'AI Gen'");
      expect(js).toContain("AI: 'AI Gen'");
      expect(js).toContain("MANUAL: 'Thủ công'");
      expect(js).toContain("IMPORT: 'Thủ công'");
    });
  });

  describe('Thumbnails', () => {
    it('list returns thumbnailUrl computed via getThumbnailUrl, not raw generatedImageUrl', () => {
      const source = fs.readFileSync('src/modules/dashboard/index.ts', 'utf8');
      expect(source).toContain('getThumbnailUrl(item.generatedImageUrl)');
      expect(source).not.toContain("thumbnailUrl: item.generatedImageUrl || null");
    });

    it('thumbnail utility generates deterministic path from original URL', () => {
      const thumbSrc = fs.readFileSync('src/utils/thumbnail.ts', 'utf8');
      expect(thumbSrc).toContain('/uploads/thumbnails/');
      expect(thumbSrc).toContain('.webp');
    });

    it('thumbnail uses Sharp with 160x160 cover fit and WebP output', () => {
      const thumbSrc = fs.readFileSync('src/utils/thumbnail.ts', 'utf8');
      expect(thumbSrc).toContain("sharp");
      expect(thumbSrc).toContain("resize(");
      expect(thumbSrc).toContain("fit: 'cover'");
      expect(thumbSrc).toContain("withoutEnlargement: true");
      expect(thumbSrc).toContain(".webp(");
    });

    it('thumbnail skips generation if file already exists', () => {
      const thumbSrc = fs.readFileSync('src/utils/thumbnail.ts', 'utf8');
      expect(thumbSrc).toContain('if (fs.existsSync(thumbPath)) return thumbUrl');
    });

    it('thumbnail returns null for non-local URLs', () => {
      const thumbSrc = fs.readFileSync('src/utils/thumbnail.ts', 'utf8');
      expect(thumbSrc).toContain("if (!originalUrl.startsWith('/uploads/')) return null");
    });

    it('content list template uses only thumbnailUrl, not generatedImageUrl for display', () => {
      const html = fs.readFileSync('public/pages/content.html', 'utf8');
      const thumbSection = html.substring(html.indexOf("col.key==='thumbnail'"), html.indexOf("col.key==='topic'"));
      expect(thumbSection).toContain(':data-src="item.thumbnailUrl"');
      expect(thumbSection).not.toContain('item.generatedImageUrl');
    });

    it('upload endpoints generate thumbnails after save', () => {
      const source = fs.readFileSync('src/modules/dashboard/index.ts', 'utf8');
      const singleUpload = source.substring(source.indexOf("upload-image'"), source.indexOf("upload-images'"));
      expect(singleUpload).toContain('generateThumbnailSafe(imageUrl)');
      const multiUpload = source.substring(source.indexOf("upload-images'"), source.indexOf("upload-video'"));
      expect(multiUpload).toContain('generateThumbnailSafe(img.url)');
    });

    it('queue worker generates thumbnails after AI image generation', () => {
      const queue = fs.readFileSync('src/queues/index.ts', 'utf8');
      expect(queue).toContain('generateThumbnailSafe');
    });

    it('backfill script exists and scans existing images', () => {
      const script = fs.readFileSync('scripts/backfill-content-thumbnails.ts', 'utf8');
      expect(script).toContain('generateThumbnail');
      expect(script).toContain('thumbnailExists');
      expect(script).toContain('Backfill complete');
    });
  });

  describe('Media multi-select filter', () => {
    it('backend accepts media query param with IMAGE, VIDEO, TEXT_ONLY values', () => {
      const source = fs.readFileSync('src/modules/dashboard/index.ts', 'utf8');
      expect(source).toContain("media,");
      expect(source).toContain("parseCsvParam(media)");
    });

    it('IMAGE media filter checks generatedImageUrl is not null', () => {
      const source = fs.readFileSync('src/modules/dashboard/index.ts', 'utf8');
      expect(source).toContain("'IMAGE') mediaOr.push({ generatedImageUrl: { not: null } })");
    });

    it('VIDEO media filter checks generatedVideoUrl is not null', () => {
      const source = fs.readFileSync('src/modules/dashboard/index.ts', 'utf8');
      expect(source).toContain("'VIDEO') mediaOr.push({ generatedVideoUrl: { not: null } })");
    });

    it('TEXT_ONLY media filter checks both image and video are null', () => {
      const source = fs.readFileSync('src/modules/dashboard/index.ts', 'utf8');
      expect(source).toContain("'TEXT_ONLY') mediaOr.push({ generatedImageUrl: null, generatedVideoUrl: null })");
    });

    it('multiple media values use OR semantics', () => {
      const source = fs.readFileSync('src/modules/dashboard/index.ts', 'utf8');
      expect(source).toContain("{ OR: mediaOr }");
    });

    it('frontend dropdown uses checkboxes with Vietnamese labels', () => {
      const html = fs.readFileSync('public/pages/content.html', 'utf8');
      expect(html).toContain("Có ảnh");
      expect(html).toContain("Có video");
      expect(html).toContain("Chỉ văn bản");
      expect(html).toContain('type="checkbox"');
    });

    it('frontend sends media param as CSV', () => {
      const js = fs.readFileSync('public/js/pages/content.js', 'utf8');
      expect(js).toContain("contentFilter.media?.length");
      expect(js).toContain("contentFilter.media.join(',')");
    });

    it('old contentType filter is replaced by media dropdown', () => {
      const html = fs.readFileSync('public/pages/content.html', 'utf8');
      expect(html).not.toContain('x-model="contentFilter.contentType"');
      expect(html).not.toContain('>Loại</option>');
      expect(html).toContain('mediaDrop');
      expect(html).toContain('toggleMediaFilter');
    });

    it('contentFilter initializes with media array instead of contentType string', () => {
      const app = fs.readFileSync('public/js/app.js', 'utf8');
      expect(app).toContain("media: []");
      expect(app).not.toContain("contentType: ''");
    });

    it('combined media + source filter both work', () => {
      const source = fs.readFileSync('src/modules/dashboard/index.ts', 'utf8');
      const contentRoute = source.substring(source.indexOf("router.get('/content'"));
      expect(contentRoute).toContain('parseCsvParam(media)');
      expect(contentRoute).toContain('mapSourceFilterToDbValues');
    });

    it('tenant security remains intact with media filter', () => {
      const source = fs.readFileSync('src/modules/dashboard/index.ts', 'utf8');
      const contentRoute = source.substring(source.indexOf("router.get('/content'"));
      expect(contentRoute).toContain('organizationId: req.organizationId');
      expect(contentRoute).toContain('getAccessContext');
    });
  });
});
