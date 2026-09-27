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

// List workspaces
router.get('/', async (_req: Request, res: Response) => {
  const workspaces = await prisma.workspace.findMany({
    include: {
      workspacePages: {
        include: { page: { select: { id: true, name: true, platform: true, externalId: true, isActive: true } } },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  const result = workspaces.map(w => ({
    id: w.id,
    name: w.name,
    slug: w.slug,
    description: w.description,
    color: w.color,
    icon: w.icon,
    createdAt: w.createdAt,
    pages: w.workspacePages.map(wp => wp.page),
    pageCount: w.workspacePages.length,
  }));

  res.json(result);
});

// Get single workspace
router.get('/:id', async (req: Request, res: Response) => {
  const workspace = await prisma.workspace.findUnique({
    where: { id: req.params.id },
    include: {
      workspacePages: {
        include: { page: { select: { id: true, name: true, platform: true, externalId: true, isActive: true } } },
      },
    },
  });
  if (!workspace) return res.status(404).json({ error: 'Workspace not found' });
  res.json({
    ...workspace,
    pages: workspace.workspacePages.map(wp => wp.page),
    pageCount: workspace.workspacePages.length,
  });
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
      include: {
        workspacePages: {
          include: { page: { select: { id: true, name: true, platform: true, externalId: true, isActive: true } } },
        },
      },
    });

    res.json({
      ...full,
      pages: full!.workspacePages.map(wp => wp.page),
      pageCount: full!.workspacePages.length,
    });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to create workspace' });
  }
});

// Update workspace
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { name, description, color, icon, pageIds } = req.body;
    const data: Record<string, unknown> = {};
    if (name !== undefined) {
      data.name = name;
      data.slug = await uniqueSlug(name, req.params.id);
    }
    if (description !== undefined) data.description = description;
    if (color !== undefined) data.color = color;
    if (icon !== undefined) data.icon = icon;

    await prisma.workspace.update({ where: { id: req.params.id }, data });

    if (pageIds !== undefined) {
      await prisma.workspacePage.deleteMany({ where: { workspaceId: req.params.id } });
      if (pageIds.length) {
        await prisma.workspacePage.createMany({
          data: pageIds.map((pageId: string) => ({ workspaceId: req.params.id, pageId })),
          skipDuplicates: true,
        });
      }
    }

    const full = await prisma.workspace.findUnique({
      where: { id: req.params.id },
      include: {
        workspacePages: {
          include: { page: { select: { id: true, name: true, platform: true, externalId: true, isActive: true } } },
        },
      },
    });

    res.json({
      ...full,
      pages: full!.workspacePages.map(wp => wp.page),
      pageCount: full!.workspacePages.length,
    });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to update workspace' });
  }
});

// Delete workspace (only the group, not pages/content)
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    await prisma.workspace.delete({ where: { id: req.params.id } });
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
      return wps.map(wp => wp.pageId);

    case 'all':
    default:
      const allPages = await prisma.page.findMany({
        where: { isActive: true },
        select: { id: true },
      });
      return allPages.map(p => p.id);
  }
}

export { router as workspaceRouter };
