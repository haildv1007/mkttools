import { getAppUrl } from '../modules/platform-settings';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0']);

function ensurePublishableUrl(url: URL): string {
  if (url.protocol !== 'https:') throw new Error('Facebook image URL must use HTTPS');
  if (LOCAL_HOSTS.has(url.hostname.toLowerCase()) || url.hostname.endsWith('.localhost')) {
    throw new Error('Facebook image URL must be publicly reachable');
  }
  if (/\/(thumbnails?|thumbs?)\//i.test(url.pathname)) {
    throw new Error('Facebook publishing requires the original image, not a thumbnail');
  }
  return url.toString();
}

/** Resolve stored media paths into the public, original HTTPS URL Facebook can fetch. */
export function resolvePublicMediaUrl(value: string): string {
  const raw = String(value || '').trim();
  if (!raw) throw new Error('Facebook image URL is empty');
  if (/^(blob|data|file):/i.test(raw)) throw new Error('Facebook image URL is not public');

  if (/^https?:\/\//i.test(raw)) return ensurePublishableUrl(new URL(raw));
  if (!raw.startsWith('/')) throw new Error('Facebook image URL must be absolute or root-relative');

  const appUrl = getAppUrl();
  return ensurePublishableUrl(new URL(raw, `${appUrl.replace(/\/$/, '')}/`));
}

/** Fail before calling Graph when the URL is unavailable or is not an image. */
export async function verifyPublicImageUrl(url: string, fetcher: typeof fetch = fetch): Promise<void> {
  const checked = ensurePublishableUrl(new URL(url));
  let response = await fetcher(checked, { method: 'HEAD', redirect: 'follow' });
  if (response.status === 405 || response.status === 501) {
    response = await fetcher(checked, { method: 'GET', redirect: 'follow', headers: { Range: 'bytes=0-0' } });
  }
  if (!response.ok) throw new Error(`Facebook image URL is not publicly reachable (HTTP ${response.status})`);
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.toLowerCase().startsWith('image/')) {
    throw new Error(`Facebook image URL has invalid Content-Type: ${contentType || 'missing'}`);
  }
}
