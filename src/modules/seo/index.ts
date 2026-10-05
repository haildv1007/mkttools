import { getAppUrl, getPlatformSetting, getPlatformSettingBool } from '../platform-settings';

export interface PublicSeoConfig {
  siteName: string;
  defaultTitle: string;
  defaultDescription: string;
  canonicalBaseUrl: string;
  allowIndexing: boolean;
  logoUrl: string;
  faviconUrl: string;
  ogTitle: string;
  ogDescription: string;
  ogImageUrl: string;
  googleSiteVerification: string;
  locale: string;
}

export interface PageSeo {
  title?: string;
  description?: string;
  path: string;
  type?: 'website' | 'article';
  noindex?: boolean;
  structuredData?: Record<string, unknown>;
}

const PAGE_META: Record<string, Pick<PageSeo, 'title' | 'description'>> = {
  '/': {
    title: 'MKTKit — Công cụ giúp marketing vận hành gọn hơn',
    description: 'MKTKit giúp đội ngũ quản lý Pages, nội dung, chiến dịch và lịch xuất bản trong một nơi.',
  },
  '/products': { title: 'Sản phẩm — MKTKit', description: 'Khám phá MKT Tools, sản phẩm vận hành nội dung và Pages của MKTKit.' },
  '/products/mkt-tools': { title: 'MKT Tools — Quản lý Pages, Content, Campaigns & AI', description: 'Một workspace để quản lý Pages, Content, Campaigns, AI và lịch xuất bản.' },
  '/guides': { title: 'Hướng dẫn sử dụng MKT Tools — MKTKit', description: 'Thiết lập và sử dụng MKT Tools từng bước.' },
  '/support': { title: 'Hỗ trợ MKTKit', description: 'Tìm hướng dẫn và liên hệ hỗ trợ MKTKit.' },
  '/legal/terms': { title: 'Điều khoản sử dụng — MKTKit', description: 'Điều khoản áp dụng khi sử dụng MKTKit.' },
  '/legal/privacy': { title: 'Chính sách bảo mật — MKTKit', description: 'Cách MKTKit xử lý và bảo vệ thông tin.' },
  '/legal/data-deletion': { title: 'Xóa dữ liệu — MKTKit', description: 'Hướng dẫn yêu cầu xóa tài khoản và dữ liệu.' },
  '/legal/data-deletion/mkt-tools': { title: 'Xóa dữ liệu MKT Tools — MKTKit', description: 'Quy trình yêu cầu xóa dữ liệu MKT Tools.' },
  '/blog': { title: 'Blog MKTKit', description: 'Kiến thức thực tế để vận hành marketing tốt hơn.' },
};

function trimSlash(value: string): string { return value.replace(/\/+$/, ''); }

function safeHttpUrl(value: string, fallback = ''): string {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? trimSlash(url.toString()) : fallback;
  } catch { return fallback; }
}

function safeAssetUrl(value: string, baseUrl: string): string {
  if (value.startsWith('/uploads/seo/')) {
    try { return new URL(value, `${trimSlash(baseUrl)}/`).toString(); } catch { return ''; }
  }
  return safeHttpUrl(value);
}

export function getPublicSeoConfig(): PublicSeoConfig {
  const appUrl = safeHttpUrl(getAppUrl(), 'http://localhost:3000');
  const canonicalBaseUrl = safeHttpUrl(getPlatformSetting('seo.canonicalBaseUrl'), appUrl);
  return {
    siteName: getPlatformSetting('seo.siteName') || getPlatformSetting('general.productName') || 'MKTKit',
    defaultTitle: getPlatformSetting('seo.defaultTitle') || 'MKTKit',
    defaultDescription: getPlatformSetting('seo.defaultDescription'),
    canonicalBaseUrl,
    allowIndexing: getPlatformSettingBool('seo.allowIndexing') && isProductionLikeUrl(canonicalBaseUrl),
    logoUrl: safeAssetUrl(getPlatformSetting('seo.logoUrl'), canonicalBaseUrl),
    faviconUrl: safeAssetUrl(getPlatformSetting('seo.faviconUrl'), canonicalBaseUrl),
    ogTitle: getPlatformSetting('seo.ogTitle'),
    ogDescription: getPlatformSetting('seo.ogDescription'),
    ogImageUrl: safeAssetUrl(getPlatformSetting('seo.ogImageUrl'), canonicalBaseUrl),
    googleSiteVerification: getPlatformSetting('seo.googleSiteVerification'),
    locale: getPlatformSetting('seo.locale') || 'vi_VN',
  };
}

export function isProductionLikeUrl(value: string): boolean {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return !['localhost', '127.0.0.1', '::1'].includes(host)
      && !/(^|\.)(local|test|invalid)$/.test(host)
      && !/(^|[-.])(staging|stage|dev|test)([-.]|$)/.test(host);
  } catch { return false; }
}

export function getPageSeo(pathname: string): PageSeo {
  const cleanPath = pathname.replace(/\/+$/, '') || '/';
  const meta = PAGE_META[cleanPath] || {};
  return { path: cleanPath, ...meta };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char] || char));
}

function jsonForHtml(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
}

export function renderSeoHead(page: PageSeo, config = getPublicSeoConfig()): string {
  const title = page.title || config.defaultTitle || config.siteName;
  const description = page.description || config.defaultDescription;
  const canonical = `${config.canonicalBaseUrl}${page.path === '/' ? '/' : page.path}`;
  const ogTitle = page.title || config.ogTitle || title;
  const ogDescription = page.description || config.ogDescription || description;
  const noindex = page.noindex || !config.allowIndexing;
  const tags = [
    `<title>${escapeHtml(title)}</title>`,
    `<meta name="description" content="${escapeHtml(description)}">`,
    `<link rel="canonical" href="${escapeHtml(canonical)}">`,
    `<meta name="robots" content="${noindex ? 'noindex, nofollow' : 'index, follow'}">`,
    '<meta property="og:type" content="' + (page.type || 'website') + '">',
    `<meta property="og:title" content="${escapeHtml(ogTitle)}">`,
    `<meta property="og:description" content="${escapeHtml(ogDescription)}">`,
    `<meta property="og:url" content="${escapeHtml(canonical)}">`,
    `<meta property="og:site_name" content="${escapeHtml(config.siteName)}">`,
    `<meta property="og:locale" content="${escapeHtml(config.locale)}">`,
    config.ogImageUrl ? `<meta property="og:image" content="${escapeHtml(config.ogImageUrl)}">` : '',
    `<meta name="twitter:card" content="${config.ogImageUrl ? 'summary_large_image' : 'summary'}">`,
    config.ogImageUrl ? `<meta name="twitter:image" content="${escapeHtml(config.ogImageUrl)}">` : '',
    config.googleSiteVerification ? `<meta name="google-site-verification" content="${escapeHtml(config.googleSiteVerification)}">` : '',
    config.faviconUrl ? `<link rel="icon" href="${escapeHtml(config.faviconUrl)}">` : `<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%230866ff'/%3E%3Cpath d='M8 10h4l4 5 4-5h4v12h-4v-6l-4 5-4-5v6H8z' fill='white'/%3E%3C/svg%3E">`,
    page.structuredData ? `<script type="application/ld+json">${jsonForHtml(page.structuredData)}</script>` : '',
    `<script id="public-seo-config" type="application/json">${jsonForHtml({ ...config, googleSiteVerification: undefined })}</script>`,
  ];
  return tags.filter(Boolean).join('\n  ');
}

export function publicStructuredData(pathname: string, config = getPublicSeoConfig()): Record<string, unknown> | undefined {
  if (pathname === '/') return {
    '@context': 'https://schema.org', '@type': 'Organization', name: config.siteName,
    url: `${config.canonicalBaseUrl}/`, ...(config.logoUrl ? { logo: config.logoUrl } : {}),
  };
  if (pathname === '/products/mkt-tools') return {
    '@context': 'https://schema.org', '@type': 'SoftwareApplication', name: 'MKT Tools',
    applicationCategory: 'BusinessApplication', operatingSystem: 'Web',
    url: `${config.canonicalBaseUrl}/products/mkt-tools`, description: PAGE_META[pathname].description,
  };
  return undefined;
}

export function renderPublicDocument(template: string, page: PageSeo, config = getPublicSeoConfig()): string {
  const withData = { ...page, structuredData: page.structuredData || publicStructuredData(page.path, config) };
  let html = template.replace('<!-- SEO_HEAD -->', renderSeoHead(withData, config));
  if (config.logoUrl) {
    const logo = `<img class="brand-logo" src="${escapeHtml(config.logoUrl)}" alt="" aria-hidden="true">`;
    html = html.replaceAll('<span class="brand-mark" aria-hidden="true">M</span>', logo);
  }
  return html;
}

export function escapeXml(value: string): string { return escapeHtml(value); }

export function buildSitemapXml(paths: string[], baseUrl: string): string {
  const origin = trimSlash(baseUrl);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${paths.map((entry) => `  <url><loc>${escapeXml(origin + entry)}</loc></url>`).join('\n')}\n</urlset>`;
}

export function buildRobotsTxt(config: Pick<PublicSeoConfig, 'allowIndexing' | 'canonicalBaseUrl'>): string {
  if (!config.allowIndexing) return 'User-agent: *\nDisallow: /\n';
  return `User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\nDisallow: /login\nDisallow: /register\nDisallow: /forgot-password\nDisallow: /reset-password\nDisallow: /verify-email\nDisallow: /onboarding\nDisallow: /join\nDisallow: /dashboard\nDisallow: /organization\nDisallow: /settings\nDisallow: /content\nDisallow: /campaigns\nDisallow: /import\nDisallow: /pages\nDisallow: /billing\nDisallow: /account\n\nSitemap: ${trimSlash(config.canonicalBaseUrl)}/sitemap.xml\n`;
}
