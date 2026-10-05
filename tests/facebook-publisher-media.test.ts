import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { publishToFacebook } from '../src/modules/publisher/providers/facebook';

afterEach(() => vi.unstubAllGlobals());

describe('Facebook publisher media paths', () => {
  it('publishes a manual local image through its verified absolute public URL', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mkt-fb-manual-'));
    const image = join(dir, 'manual.jpg');
    writeFileSync(image, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    const request = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 200, headers: { 'Content-Type': 'image/jpeg' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ post_id: 'page_post' }), { status: 200 }));
    vi.stubGlobal('fetch', request);
    try {
      const result = await publishToFacebook({ pageId: 'page', accessToken: 'server-token', message: 'Manual', imageLocalPath: image, imageUrl: 'https://autopost.mktkit.com/uploads/images/manual.jpg' });
      expect(result.success).toBe(true);
      expect(request).toHaveBeenCalledTimes(2);
      const body = request.mock.calls[1][1].body as URLSearchParams;
      expect(body.get('url')).toBe('https://autopost.mktkit.com/uploads/images/manual.jpg');
      expect(body.get('source')).toBeNull();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('verifies and sends the absolute original AI image URL', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 200, headers: { 'Content-Type': 'image/png' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ post_id: 'page_post' }), { status: 200 }));
    vi.stubGlobal('fetch', request);
    const imageUrl = 'https://autopost.mktkit.com/uploads/img-ai.png';
    const result = await publishToFacebook({ pageId: 'page', accessToken: 'server-token', message: 'AI', imageUrl });
    expect(result.success).toBe(true);
    const graphBody = request.mock.calls[1][1].body as URLSearchParams;
    expect(graphBody.get('url')).toBe(imageUrl);
  });

  it('publishes text-only content through feed without an image url', async () => {
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'page_post' }), { status: 200 }));
    vi.stubGlobal('fetch', request);
    const result = await publishToFacebook({ pageId: 'page', accessToken: 'server-token', message: 'Text only' });
    expect(result.success).toBe(true);
    expect(String(request.mock.calls[0][0])).toContain('/feed');
    const body = request.mock.calls[0][1].body as URLSearchParams;
    expect(body.get('url')).toBeNull();
  });
});
