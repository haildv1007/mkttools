import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('customer-facing localization', () => {
  it('loads the shared locale runtime across the public-to-app flow', () => {
    for (const page of ['public/mktkit/index.html', 'public/auth.html', 'public/index.html', 'public/billing.html']) {
      const html = read(page);
      expect(html, `${page} should load i18n.js`).toContain('/js/i18n.js?v=1');
      expect(html, `${page} should load i18n.css`).toContain('/css/i18n.css?v=1');
    }
  });

  it('supports Vietnamese and English with a persisted locale', () => {
    const runtime = read('public/js/i18n.js');
    expect(runtime).toContain("const SUPPORTED = ['vi', 'en']");
    expect(runtime).toContain("const STORAGE_KEY = 'mkt_locale'");
    expect(runtime).toContain("document.documentElement.lang = locale");
    expect(runtime).toContain("new MutationObserver");
  });

  it('carries English into customer auth links', () => {
    const runtime = read('public/js/i18n.js');
    expect(runtime).toContain("url.searchParams.set('lang', 'en')");
    expect(runtime).toContain("mktkit\\.(com|vn)");
  });
});
