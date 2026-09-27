import { Router, Request, Response } from 'express';
import { prisma } from '../../utils/db';

const router = Router();

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 100) || 'workspace';
}

async function uniqueSlug(base: string, excludeId?: string): Promise<string> {
  let slug = slugify(base);
  let suffix = 0;
  while (true) {
    const candidate = suffix === 0 ? slug : `${slug}-${suffix}`;
    const existing = await prisma.workspace.findUnique({ where: { slug: candidate } });
    if (!existing || existing.id === excludeId) return candidate;
    suffix++;
  }
}

const pageInclude = {
  workspacePages: {
    include: { page: { select: { id: true, name: true, platform: true, externalId: true, isActive: true } } },
  },
} as const;

function formatWorkspace(w: any) {
  return {
    id: w.id,
    name: w.name,
    slug: w.slug,
    description: w.description,
    color: w.color,
    icon: w.icon,
    createdAt: w.createdAt,
    pages: w.workspacePages.map((wp: any) => wp.page),
    pageCount: w.workspacePages.length,
  };
}

// List workspaces
router.get('/', async (_req: Request, res: Response) => {
  const workspaces = await prisma.workspace.findMany({
    include: pageInclude,
    orderBy: { createdAt: 'desc' },
  });
  res.json(workspaces.map(formatWorkspace));
});

// Get single workspace
router.get('/:id', async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const workspace = await prisma.workspace.findUnique({
    where: { id },
    include: pageInclude,
  });
  if (!workspace) return res.status(404).json({ error: 'Workspace not found' });
  res.json(formatWorkspace(workspace));
});

// Create workspace
router.post('/', async (req: Request, res: Response) => {
  try {
    const { name, description, color, icon, pageIds } = req.body;
    if (!name) return res.status(400).json({ error: 'Tên workspace là bắt buộc' });

    const slug = await uniqueSlug(name);
    const workspace = await prisma.workspace.create({
      data: {
        name,
        slug,
        description: description || null,
        color: color || null,
        icon: icon || null,
        createdBy: (req as any).user?.id || null,
      },
    });

    if (pageIds?.length) {
      await prisma.workspacePage.createMany({
        data: pageIds.map((pageId: string) => ({ workspaceId: workspace.id, pageId })),
        skipDuplicates: true,
      });
    }

    const full = await prisma.workspace.findUnique({
      where: { id: workspace.id },
      include: pageInclude,
    });
    res.json(formatWorkspace(full));
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to create workspace' });
  }
});

// Update workspace
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const { name, description, color, icon, pageIds } = req.body;
    const data: Record<string, unknown> = {};
    if (name !== undefined) {
      data.name = name;
      data.slug = await uniqueSlug(name, id);
    }
    if (description !== undefined) data.description = description;
    if (color !== undefined) data.color = color;
    if (icon !== undefined) data.icon = icon;

    await prisma.workspace.update({ where: { id }, data });

    if (pageIds !== undefined) {
      await prisma.workspacePage.deleteMany({ where: { workspaceId: id } });
      if (pageIds.length) {
        await prisma.workspacePage.createMany({
          data: pageIds.map((pageId: string) => ({ workspaceId: id, pageId })),
          skipDuplicates: true,
        });
      }
    }

    const full = await prisma.workspace.findUnique({
      where: { id },
      include: pageInclude,
    });
    res.json(formatWorkspace(full));
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to update workspace' });
  }
});

// Delete workspace (only the group, not pages/content)
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    await prisma.workspace.delete({ where: { id } });
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to delete workspace' });
  }
});

// Scope resolver endpoint
router.get('/resolve-scope', async (req: Request, res: Response) => {
  try {
    const { type, id } = req.query;
    const pageIds = await resolvePageIds(String(type || 'all'), id ? String(id) : undefined);
    res.json({ pageIds });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to resolve scope' });
  }
});

// Reusable scope resolver
export async function resolvePageIds(scopeType: string, scopeId?: string): Promise<string[]> {
  switch (scopeType) {
    case 'page':
      if (!scopeId) return [];
      const page = await prisma.page.findUnique({ where: { id: scopeId }, select: { id: true, isActive: true } });
      if (!page || !page.isActive) return [];
      return [scopeId];

    case 'workspace':
      if (!scopeId) return [];
      const wps = await prisma.workspacePage.findMany({
        where: { workspaceId: scopeId, page: { isActive: true } },
        select: { pageId: true },
      });
      return wps.map((wp: any) => wp.pageId);

    case 'all':
    default:
      const allPages = await prisma.page.findMany({
        where: { isActive: true },
        select: { id: true },
      });
      return allPages.map((p: any) => p.id);
  }
}

export { router as workspaceRouter };
