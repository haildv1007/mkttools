import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import {
  buildRobotsTxt,
  buildSitemapXml,
  getPageSeo,
  isProductionLikeUrl,
  PublicSeoConfig,
  renderPublicDocument,
} from '../src/modules/seo';

const config: PublicSeoConfig = {
  siteName: 'MKTKit',
  defaultTitle: 'Default title',
  defaultDescription: 'Default description',
  canonicalBaseUrl: 'https://mktkit.com',
  allowIndexing: true,
  logoUrl: 'https://mktkit.com/logo.png',
  faviconUrl: 'https://mktkit.com/favicon.png',
  ogTitle: 'Default OG',
  ogDescription: 'Default OG description',
  ogImageUrl: 'https://mktkit.com/og.png',
  googleSiteVerification: 'verification-token',
  locale: 'vi_VN',
};

describe('public SEO rendering', () => {
  const template = readFileSync(path.join(process.cwd(), 'public/mktkit/index.html'), 'utf8');

  it('renders one canonical, title and description with safe absolute social metadata', () => {
    const pages = [
      getPageSeo('/'),
      getPageSeo('/products/mkt-tools'),
      { path: '/guides/ket-noi-facebook-pages', title: 'Kết nối Facebook Pages — MKTKit', description: 'Thêm Page vào MKT Tools.', type: 'article' as const },
      getPageSeo('/legal/privacy'),
      getPageSeo('/support'),
    ];
    for (const page of pages) {
      const html = renderPublicDocument(template, page, config);
      expect(html.match(/<title>/g), page.path).toHaveLength(1);
      expect(html.match(/<meta name="description"/g), page.path).toHaveLength(1);
      expect(html.match(/<link rel="canonical"/g), page.path).toHaveLength(1);
      expect(html, page.path).toContain(`href="https://mktkit.com${page.path}"`);
      expect(html).toContain('property="og:image" content="https://mktkit.com/og.png"');
      expect(html).toContain('name="google-site-verification" content="verification-token"');
    }
  });

  it('keeps an unknown content route non-indexable', () => {
    const html = renderPublicDocument(template, { path: '/guides/unknown', noindex: true }, config);
    expect(html).toContain('<meta name="robots" content="noindex, nofollow">');
  });

  it('renders only factual Organization and SoftwareApplication JSON-LD', () => {
    expect(renderPublicDocument(template, getPageSeo('/'), config)).toContain('"@type":"Organization"');
    const product = renderPublicDocument(template, getPageSeo('/products/mkt-tools'), config);
    expect(product).toContain('"@type":"SoftwareApplication"');
    const jsonLd = product.match(/<script type="application\/ld\+json">(.*?)<\/script>/)?.[1] || '';
    expect(jsonLd).not.toMatch(/"rating"|"reviewCount"|"offers"|"price"/i);
  });

  it('forces local and staging-style canonical hosts out of the index', () => {
    expect(isProductionLikeUrl('http://localhost:3000')).toBe(false);
    expect(isProductionLikeUrl('https://staging.mktkit.com')).toBe(false);
    expect(isProductionLikeUrl('https://mktkit.com')).toBe(true);
  });
});

describe('robots and sitemap', () => {
  it('blocks everything when indexing is disabled', () => {
    expect(buildRobotsTxt({ allowIndexing: false, canonicalBaseUrl: 'http://localhost:3000' })).toBe('User-agent: *\nDisallow: /\n');
  });

  it('allows public content while disallowing private areas', () => {
    const robots = buildRobotsTxt(config);
    expect(robots).toContain('Allow: /');
    expect(robots).toContain('Disallow: /admin');
    expect(robots).toContain('Disallow: /content');
    expect(robots).toContain('Sitemap: https://mktkit.com/sitemap.xml');
  });

  it('contains only the explicitly supplied public URLs', () => {
    const xml = buildSitemapXml(['/', '/guides/example'], 'https://mktkit.com');
    expect(xml).toContain('<loc>https://mktkit.com/guides/example</loc>');
    expect(xml).not.toMatch(/admin|login|api\//);
  });
});
