import sharp from 'sharp';
import path from 'path';
import fs from 'fs';

const THUMBNAIL_DIR = path.join(process.cwd(), 'public', 'uploads', 'thumbnails');
const PUBLIC_DIR = path.join(process.cwd(), 'public');

const THUMB_SIZE = 160;
const THUMB_QUALITY = 75;

if (!fs.existsSync(THUMBNAIL_DIR)) fs.mkdirSync(THUMBNAIL_DIR, { recursive: true });

export function getThumbnailUrl(originalUrl: string | null): string | null {
  if (!originalUrl) return null;
  if (!originalUrl.startsWith('/uploads/')) return null;
  const basename = path.basename(originalUrl);
  const nameWithoutExt = basename.replace(/\.[^.]+$/, '');
  return `/uploads/thumbnails/${nameWithoutExt}.webp`;
}

export function thumbnailExists(originalUrl: string): boolean {
  const thumbUrl = getThumbnailUrl(originalUrl);
  if (!thumbUrl) return false;
  return fs.existsSync(path.join(PUBLIC_DIR, thumbUrl));
}

export async function generateThumbnail(originalUrl: string): Promise<string | null> {
  if (!originalUrl.startsWith('/uploads/')) return null;

  const origPath = path.join(PUBLIC_DIR, originalUrl);
  if (!fs.existsSync(origPath)) return null;

  const thumbUrl = getThumbnailUrl(originalUrl)!;
  const thumbPath = path.join(PUBLIC_DIR, thumbUrl);

  if (fs.existsSync(thumbPath)) return thumbUrl;

  await sharp(origPath)
    .resize(THUMB_SIZE, THUMB_SIZE, { fit: 'cover', withoutEnlargement: true })
    .webp({ quality: THUMB_QUALITY })
    .toFile(thumbPath);

  return thumbUrl;
}

export async function generateThumbnailSafe(originalUrl: string): Promise<string | null> {
  try {
    return await generateThumbnail(originalUrl);
  } catch {
    return null;
  }
}
