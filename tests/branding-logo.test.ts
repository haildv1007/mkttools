import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '..');
const read = (file: string) => readFileSync(resolve(root, file), 'utf8');

describe('platform logo branding', () => {
  it('exposes configured logo and favicon to static application shells', () => {
    const source = read('src/index.ts');
    expect(source).toContain("logoUrl: safeAssetUrl('seo.logoUrl')");
    expect(source).toContain("faviconUrl: safeAssetUrl('seo.faviconUrl')");
    expect(source).toContain("value.startsWith('/uploads/seo/')");
  });

  it('renders the configured logo with an icon fallback', () => {
    const branding = read('public/js/branding.js');
    expect(branding).toContain("document.querySelectorAll('[data-platform-logo]')");
    expect(branding).toContain('image.onerror');
    for (const page of ['public/index.html', 'public/auth.html', 'public/admin.html']) {
      expect(read(page)).toContain('data-platform-logo');
      expect(read(page)).toContain('data-platform-logo-fallback');
    }
  });

  it('optimizes future logo uploads for UI use', () => {
    const source = read('src/modules/platform-settings/index.ts');
    expect(source).toContain("filename: 'logo.webp'");
    expect(source).toContain("width: 256, height: 256");
    expect(source).toContain("webp({ quality: 84");
  });
});
