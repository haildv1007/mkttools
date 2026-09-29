import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import { verifySessionToken } from '../modules/auth/session';
import { logger } from '../utils/logger';
import { prisma } from '../utils/db';


let io: Server | null = null;

export interface ContentEvent {
  contentId: string;
  pageId: string;
  organizationId?: string;
  campaignId?: string;
  operation: 'generate' | 'publish' | 'approve' | 'delete' | 'bulk_generate' | 'bulk_publish' | 'bulk_approve' | 'bulk_delete';
  status: 'started' | 'progress' | 'completed' | 'failed';
  step?: string;
  progressCurrent?: number;
  progressTotal?: number;
  safeMessage?: string;
  contentTitle?: string;
  pageName?: string;
  pageAvatar?: string;
  campaignName?: string;
  thumbnailUrl?: string;
  contentStatus?: string;
  startedAt?: string;
  updatedAt: string;
  version: number;
}

export interface ActivityEvent {
  id: string;
  organizationId?: string;
  action: string;
  category: string;
  status: string;
  summary: string;
  detail?: string;
  entityType?: string;
  entityId?: string;
  entityLabel?: string;
  progress?: number;
  total?: number;
  errorCode?: string;
  createdAt: string;
  updatedAt: string;
}

export function initSocketIO(server: HttpServer): Server {
  io = new Server(server, {
    cors: { origin: '*' },
    transports: ['websocket', 'polling'],
    pingInterval: 25000,
    pingTimeout: 20000,
  });

  io.use(async (socket: Socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Authentication required'));
    const payload = await verifySessionToken(token);
    if (!payload) return next(new Error('Invalid token'));
    (socket as any).userId = payload.userId;
    (socket as any).userRole = payload.role;
    next();
  });

  io.on('connection', async (socket: Socket) => {
    const userId = (socket as any).userId as string;
    socket.join(`user:${userId}`);
    logger.debug({ userId, socketId: socket.id }, 'Socket connected');

    // Verify + join a tenant room. Client provides orgId; server validates membership.
    async function joinOrg(orgId: string) {
      try {
        if (!orgId || typeof orgId !== 'string') return;
        const m = await prisma.organizationMember.findUnique({
          where: { organizationId_userId: { organizationId: orgId, userId } },
          select: { status: true, role: true, accessMode: true },
        });
        if (!m || m.status !== 'ACTIVE') {
          socket.emit('org:denied', { organizationId: orgId });
          return;
        }
        // Leave any prior org rooms first — one active org per socket.
        for (const room of socket.rooms) {
          if (room.startsWith('org:') || room.startsWith('page:')) socket.leave(room);
        }
        (socket as any).organizationId = orgId;
        const isAllAccess = m.role === 'OWNER' || m.role === 'ADMIN' || m.accessMode === 'ALL';
        // Only ALL-access members receive org-wide broadcasts. Restricted
        // members rely on page rooms so we never leak inaccessible content.
        if (isAllAccess) socket.join(`org:${orgId}`);
      } catch (e) {
        logger.warn({ err: e }, 'joinOrg failed');
      }
    }

    const initialOrg = (socket.handshake.auth?.organizationId as string) || '';
    if (initialOrg) {
      await joinOrg(initialOrg);
    } else {
      const first = await prisma.organizationMember.findFirst({
        where: { userId, status: 'ACTIVE', organization: { status: 'ACTIVE' } },
        orderBy: { createdAt: 'asc' },
        select: { organizationId: true },
      });
      if (first) await joinOrg(first.organizationId);
    }

    socket.on('subscribe:org', (orgId: string) => joinOrg(orgId));

    async function canJoinPage(pageId: string): Promise<boolean> {
      const currentOrg = (socket as any).organizationId as string | undefined;
      if (!currentOrg) return false;
      const page = await prisma.page.findUnique({ where: { id: pageId }, select: { organizationId: true } });
      if (!page || page.organizationId !== currentOrg) return false;
      // Restricted members: enforce access before allowing a page room join.
      const m = await prisma.organizationMember.findUnique({
        where: { organizationId_userId: { organizationId: currentOrg, userId } },
        select: { id: true, role: true, accessMode: true, status: true },
      });
      if (!m || m.status !== 'ACTIVE') return false;
      const isAllAccess = m.role === 'OWNER' || m.role === 'ADMIN' || m.accessMode === 'ALL';
      if (isAllAccess) return true;
      const { getAccessiblePageIds } = await import('../modules/access');
      const ids = await getAccessiblePageIds({
        organizationId: currentOrg, userId, role: m.role as any, accessMode: m.accessMode as any,
        memberId: m.id, isAllAccess: false,
      });
      return ids.includes(pageId);
    }

    socket.on('subscribe:page', async (pageId: string) => {
      if (typeof pageId !== 'string' || pageId.length >= 100) return;
      if (await canJoinPage(pageId)) socket.join(`page:${pageId}`);
      else socket.emit('page:denied', { pageId });
    });

    socket.on('unsubscribe:page', (pageId: string) => {
      socket.leave(`page:${pageId}`);
    });

    socket.on('subscribe:scope', async (data: { type: string; pageIds: string[] }) => {
      if (!data?.pageIds?.length) return;
      const wanted = data.pageIds.slice(0, 500);
      for (const pid of wanted) {
        if (await canJoinPage(pid)) socket.join(`page:${pid}`);
      }
    });

    socket.on('disconnect', () => {
      logger.debug({ userId, socketId: socket.id }, 'Socket disconnected');
    });
  });

  logger.info('Socket.IO initialized');
  return io;
}

export function getIO(): Server | null {
  return io;
}

export function emitActivity(event: ActivityEvent) {
  if (!io) return;
  if (event.organizationId) {
    io.to(`org:${event.organizationId}`).emit('activity:update', event);
    return;
  }
  // Legacy events without org — restrict to server-side subscribers only.
  io.emit('activity:update', event);
}

export function emitContentUpdate(event: ContentEvent) {
  if (!io) return;
  if (event.pageId) io.to(`page:${event.pageId}`).emit('content:update', event);
  if (event.organizationId) {
    io.to(`org:${event.organizationId}`).emit('content:update:global', event);
  }
}

export function emitStatusCounts(pageId: string, counts: Record<string, number>) {
  if (!io) return;
  io.to(`page:${pageId}`).emit('content:counts', { pageId, counts });
}

export function emitMemberAccessChanged(userId: string, organizationId: string) {
  if (!io) return;
  io.to(`user:${userId}`).emit('member:access-changed', { organizationId, at: new Date().toISOString() });
}
