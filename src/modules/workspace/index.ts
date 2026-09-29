import { Router, Response } from 'express';
import { prisma } from '../../utils/db';
import { AuthRequest } from '../../middleware/auth';
import { getAccessContext, getAccessibleWorkspaceIds, getAccessiblePageIds, canAccessWorkspace, canAccessPage } from '../access';

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
    include: { page: { select: { id: true, name: true, platform: true, externalId: true, isActive: true, organizationId: true } } },
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

router.get('/', async (req: AuthRequest, res: Response) => {
  const where: Record<string, unknown> = { organizationId: req.organizationId };
  if (!req.isAllAccess && req.userId) {
    const ctx = await getAccessContext(req.organizationId!, req.userId);
    const ids = ctx ? await getAccessibleWorkspaceIds(ctx) : [];
    where.id = { in: ids };
  }
  const workspaces = await prisma.workspace.findMany({
    where,
    include: pageInclude,
    orderBy: { createdAt: 'desc' },
  });
  // For restricted members, hide inaccessible pages inside the workspace payload.
  let accessible: string[] | null = null;
  if (!req.isAllAccess && req.userId) {
    const ctx = await getAccessContext(req.organizationId!, req.userId);
    accessible = ctx ? await getAccessiblePageIds(ctx) : [];
  }
  res.json(workspaces.map((w) => {
    if (accessible) {
      w = { ...w, workspacePages: w.workspacePages.filter((wp: any) => accessible!.includes(wp.pageId)) };
    }
    return formatWorkspace(w);
  }));
});

router.get('/resolve-scope', async (req: AuthRequest, res: Response) => {
  try {
    const { type, id } = req.query;
    const pageIds = await resolvePageIds(String(type || 'all'), id ? String(id) : undefined, req.organizationId!);
    res.json({ pageIds });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to resolve scope' });
  }
});

router.get('/:id', async (req: AuthRequest, res: Response) => {
  const id = req.params.id as string;
  const workspace = await prisma.workspace.findUnique({
    where: { id },
    include: pageInclude,
  });
  if (!workspace || workspace.organizationId !== req.organizationId) {
    return res.status(404).json({ error: 'Workspace not found' });
  }
  if (!req.isAllAccess && req.userId) {
    const ctx = await getAccessContext(req.organizationId!, req.userId);
    if (!ctx || !(await canAccessWorkspace(ctx, id))) return res.status(404).json({ error: 'Workspace not found' });
  }
  res.json(formatWorkspace(workspace));
});

async function filterOrgPageIds(orgId: string, pageIds: string[]): Promise<string[]> {
  if (!pageIds.length) return [];
  const pages = await prisma.page.findMany({
    where: { id: { in: pageIds }, organizationId: orgId },
    select: { id: true },
  });
  return pages.map((p) => p.id);
}

function requireAdminOrOwner(req: AuthRequest, res: Response): boolean {
  if (!['OWNER', 'ADMIN'].includes(req.organizationRole || '')) {
    res.status(403).json({ error: 'FORBIDDEN', message: 'Chỉ Owner/Admin được quản lý Workspace.' });
    return false;
  }
  return true;
}

router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    if (!requireAdminOrOwner(req, res)) return;
    const { name, description, color, icon, pageIds } = req.body;
    if (!name) return res.status(400).json({ error: 'Tên workspace là bắt buộc' });

    const slug = await uniqueSlug(name);
    const workspace = await prisma.workspace.create({
      data: {
        organizationId: req.organizationId!,
        name,
        slug,
        description: description || null,
        color: color || null,
        icon: icon || null,
        createdBy: req.userId || null,
      },
    });

    if (pageIds?.length) {
      const safePageIds = await filterOrgPageIds(req.organizationId!, pageIds);
      if (safePageIds.length) {
        await prisma.workspacePage.createMany({
          data: safePageIds.map((pageId) => ({ workspaceId: workspace.id, pageId })),
          skipDuplicates: true,
        });
      }
    }

    const full = await prisma.workspace.findUnique({ where: { id: workspace.id }, include: pageInclude });
    res.json(formatWorkspace(full));
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to create workspace' });
  }
});

router.put('/:id', async (req: AuthRequest, res: Response) => {
  try {
    if (!requireAdminOrOwner(req, res)) return;
    const id = req.params.id as string;
    const existing = await prisma.workspace.findUnique({ where: { id } });
    if (!existing || existing.organizationId !== req.organizationId) {
      return res.status(404).json({ error: 'Workspace not found' });
    }
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
      const safePageIds = await filterOrgPageIds(req.organizationId!, pageIds);
      if (safePageIds.length) {
        await prisma.workspacePage.createMany({
          data: safePageIds.map((pageId) => ({ workspaceId: id, pageId })),
          skipDuplicates: true,
        });
      }
    }

    const full = await prisma.workspace.findUnique({ where: { id }, include: pageInclude });
    res.json(formatWorkspace(full));
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to update workspace' });
  }
});

router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    if (!requireAdminOrOwner(req, res)) return;
    const id = req.params.id as string;
    const existing = await prisma.workspace.findUnique({ where: { id } });
    if (!existing || existing.organizationId !== req.organizationId) {
      return res.status(404).json({ error: 'Workspace not found' });
    }
    await prisma.workspace.delete({ where: { id } });
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to delete workspace' });
  }
});

/**
 * Tenant-scoped page id resolver. If orgId is omitted this is legacy behavior
 * (returns global set) — callers that pass an orgId (all modern paths) always
 * stay inside that org.
 */
export async function resolvePageIds(scopeType: string, scopeId?: string, organizationId?: string): Promise<string[]> {
  switch (scopeType) {
    case 'page': {
      if (!scopeId) return [];
      const page = await prisma.page.findUnique({ where: { id: scopeId }, select: { id: true, isActive: true, organizationId: true } });
      if (!page || !page.isActive) return [];
      if (organizationId && page.organizationId !== organizationId) return [];
      return [scopeId];
    }
    case 'workspace': {
      if (!scopeId) return [];
      const ws = await prisma.workspace.findUnique({ where: { id: scopeId }, select: { organizationId: true } });
      if (!ws) return [];
      if (organizationId && ws.organizationId !== organizationId) return [];
      const wps = await prisma.workspacePage.findMany({
        where: {
          workspaceId: scopeId,
          page: {
            isActive: true,
            ...(organizationId ? { organizationId } : {}),
          },
        },
        select: { pageId: true },
      });
      return wps.map((wp: any) => wp.pageId);
    }
    case 'all':
    default: {
      const allPages = await prisma.page.findMany({
        where: {
          isActive: true,
          ...(organizationId ? { organizationId } : {}),
        },
        select: { id: true },
      });
      return allPages.map((p: any) => p.id);
    }
  }
}

export { router as workspaceRouter };
