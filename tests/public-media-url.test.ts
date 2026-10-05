import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/modules/platform-settings', () => ({
  getAppUrl: () => 'https://autopost.mktkit.com',
}));

import { resolvePublicMediaUrl, verifyPublicImageUrl } from '../src/utils/public-media-url';

describe('Facebook public media URL', () => {
  it('resolves manual-upload and AI-generated local paths against APP_URL', () => {
    expect(resolvePublicMediaUrl('/uploads/images/manual.jpg')).toBe('https://autopost.mktkit.com/uploads/images/manual.jpg');
    expect(resolvePublicMediaUrl('/uploads/img-ai.png')).toBe('https://autopost.mktkit.com/uploads/img-ai.png');
  });

  it('keeps external HTTPS original URLs unchanged', () => {
    expect(resolvePublicMediaUrl('https://cdn.example.com/original/photo.jpg')).toBe('https://cdn.example.com/original/photo.jpg');
  });

  it.each(['blob:https://autopost.mktkit.com/id', 'http://localhost:3000/a.jpg', '/uploads/thumbnails/a.jpg', 'uploads/a.jpg'])(
    'rejects non-public or non-original URL %s', (url) => expect(() => resolvePublicMediaUrl(url)).toThrow(),
  );

  it('requires a successful image response', async () => {
    const ok = vi.fn().mockResolvedValue(new Response(null, { status: 200, headers: { 'Content-Type': 'image/png' } }));
    await expect(verifyPublicImageUrl('https://autopost.mktkit.com/uploads/a.png', ok)).resolves.toBeUndefined();
    const html = vi.fn().mockResolvedValue(new Response(null, { status: 200, headers: { 'Content-Type': 'text/html' } }));
    await expect(verifyPublicImageUrl('https://autopost.mktkit.com/uploads/a.png', html)).rejects.toThrow('Content-Type');
  });

  it('does not require media for a text-only post', () => {
    const imageUrl: string | undefined = undefined;
    expect(imageUrl ? resolvePublicMediaUrl(imageUrl) : undefined).toBeUndefined();
  });
});
