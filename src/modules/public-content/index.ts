import { Router, Request, Response } from 'express';
import { promises as fs } from 'fs';
import path from 'path';

type ContentKind = 'blog' | 'guides' | 'legal';
type Frontmatter = Record<string, string>;

const router = Router();
const contentRoot = path.join(process.cwd(), 'content');

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
  }[char] || char));
}

function slugify(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/đ/g, 'd').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function renderInline(value: string): string {
  return escapeHtml(value)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+|\/[^\s)]*)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

function parseMarkdown(source: string) {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  const metadata: Frontmatter = {};
  if (match) {
    for (const line of match[1].split(/\r?\n/)) {
      const separator = line.indexOf(':');
      if (separator > 0) metadata[line.slice(0, separator).trim()] = line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '');
    }
  }
  const markdown = match ? source.slice(match[0].length) : source;
  const toc: Array<{ level: number; id: string; title: string }> = [];
  const html: string[] = [];
  let paragraph: string[] = [];
  let list: 'ul' | 'ol' | null = null;

  const flushParagraph = () => {
    if (paragraph.length) html.push(`<p>${renderInline(paragraph.join(' '))}</p>`);
    paragraph = [];
  };
  const closeList = () => {
    if (list) html.push(`</${list}>`);
    list = null;
  };

  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trim();
    const heading = line.match(/^(#{2,3})\s+(.+)$/);
    const unordered = line.match(/^[-*]\s+(.+)$/);
    const ordered = line.match(/^\d+\.\s+(.+)$/);
    if (!line) { flushParagraph(); closeList(); continue; }
    if (heading) {
      flushParagraph(); closeList();
      const level = heading[1].length;
      const title = heading[2].replace(/[*`]/g, '');
      const id = slugify(title);
      toc.push({ level, id, title });
      html.push(`<h${level} id="${id}">${renderInline(title)}</h${level}>`);
    } else if (unordered || ordered) {
      flushParagraph();
      const nextList: 'ul' | 'ol' = unordered ? 'ul' : 'ol';
      if (list !== nextList) { closeList(); list = nextList; html.push(`<${list}>`); }
      html.push(`<li>${renderInline((unordered || ordered)![1])}</li>`);
    } else if (line.startsWith('> ')) {
      flushParagraph(); closeList(); html.push(`<blockquote>${renderInline(line.slice(2))}</blockquote>`);
    } else {
      closeList(); paragraph.push(line);
    }
  }
  flushParagraph(); closeList();
  const words = markdown.split(/\s+/).filter(Boolean).length;
  return { metadata, html: html.join('\n'), toc, readTime: Math.max(1, Math.ceil(words / 220)) };
}

async function readEntry(kind: ContentKind, slug: string) {
  if (!/^[a-z0-9-]+$/.test(slug)) return null;
  try {
    const source = await fs.readFile(path.join(contentRoot, kind, `${slug}.md`), 'utf8');
    const parsed = parseMarkdown(source);
    if (parsed.metadata.published === 'false') return null;
    return { slug, ...parsed.metadata, html: parsed.html, toc: parsed.toc, readTime: parsed.readTime };
  } catch { return null; }
}

export async function hasPublishedContentEntry(kind: 'blog' | 'guides', slug: string): Promise<boolean> {
  return Boolean(await readEntry(kind, slug));
}

export async function getPublishedContentMetadata(kind: 'blog' | 'guides', slug: string) {
  const entry = await readEntry(kind, slug);
  if (!entry) return null;
  const metadata = entry as typeof entry & Frontmatter;
  return {
    slug,
    title: metadata.title || '',
    description: metadata.description || '',
    updatedAt: metadata.updatedAt || metadata.updated || metadata.date || '',
  };
}

async function listEntries(kind: ContentKind) {
  try {
    const files = (await fs.readdir(path.join(contentRoot, kind))).filter((file) => file.endsWith('.md'));
    const entries = await Promise.all(files.map((file) => readEntry(kind, file.slice(0, -3))));
    return entries.filter(Boolean).map(({ html: _html, toc: _toc, ...entry }: any) => entry)
      .sort((a: any, b: any) => String(b.date || b.updatedAt || b.updated || '').localeCompare(String(a.date || a.updatedAt || a.updated || '')));
  } catch { return []; }
}

export async function listPublishedContentEntries(kind: 'blog' | 'guides') {
  return listEntries(kind);
}

router.get('/:kind', async (req: Request, res: Response) => {
  const kind = req.params.kind as ContentKind;
  if (!['blog', 'guides'].includes(kind)) return res.status(404).json({ error: 'Không tìm thấy nội dung.' });
  res.json({ entries: await listEntries(kind) });
});

router.get('/:kind/:slug', async (req: Request, res: Response) => {
  const kind = req.params.kind as ContentKind;
  if (!['blog', 'guides', 'legal'].includes(kind)) return res.status(404).json({ error: 'Không tìm thấy nội dung.' });
  const entry = await readEntry(kind, String(req.params.slug));
  if (!entry) return res.status(404).json({ error: 'Không tìm thấy nội dung.' });
  res.json(entry);
});

export { router as publicContentRouter };
