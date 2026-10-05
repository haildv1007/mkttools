import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { prisma } from '../utils/db';
import { logger } from '../utils/logger';

const JWT_SECRET = process.env.JWT_SECRET || 'mkttools-dev-secret-change-in-production';

let io: Server | null = null;

export interface ContentEvent {
  contentId: string;
  pageId: string;
  campaignId?: string;
  organizationId?: string;
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
  organizationId?: string;
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

  io.use((socket: Socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Authentication required'));
    try {
      const payload = jwt.verify(token, JWT_SECRET) as { userId: string; role: string };
      (socket as any).userId = payload.userId;
      (socket as any).userRole = payload.role;
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket: Socket) => {
    const userId = (socket as any).userId;
    socket.join(`user:${userId}`);
    logger.debug({ userId, socketId: socket.id }, 'Socket connected');

    socket.on('subscribe:org', async (organizationId: string) => {
      if (typeof organizationId !== 'string' || organizationId.length > 100) return;
      const member = await prisma.organizationMember.findFirst({
        where: { userId, organizationId, isActive: true },
        select: { id: true },
      });
      if (!member) return;
      (socket as any).organizationId = organizationId;
      socket.join(`org:${organizationId}`);
    });

    socket.on('subscribe:page', async (pageId: string) => {
      if (typeof pageId !== 'string' || pageId.length > 100) return;
      const orgId = (socket as any).organizationId;
      if (!orgId) return;
      const page = await prisma.page.findUnique({
        where: { id: pageId },
        select: { organizationId: true },
      });
      if (!page || page.organizationId !== orgId) return;
      socket.join(`page:${pageId}`);
    });

    socket.on('unsubscribe:page', (pageId: string) => {
      socket.leave(`page:${pageId}`);
    });

    socket.on('subscribe:scope', async (data: { type: string; pageIds: string[] }) => {
      if (!data?.pageIds?.length) return;
      const orgId = (socket as any).organizationId;
      if (!orgId) return;
      const validPages = await prisma.page.findMany({
        where: { id: { in: data.pageIds.slice(0, 500) }, organizationId: orgId },
        select: { id: true },
      });
      for (const p of validPages) {
        socket.join(`page:${p.id}`);
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
  }
}

export function emitContentUpdate(event: ContentEvent) {
  if (!io) return;
  if (event.pageId) {
    io.to(`page:${event.pageId}`).emit('content:update', event);
  }
  if (event.organizationId) {
    io.to(`org:${event.organizationId}`).emit('content:update:global', event);
  }
}

export function emitStatusCounts(pageId: string, counts: Record<string, number>) {
  if (!io) return;
  io.to(`page:${pageId}`).emit('content:counts', { pageId, counts });
}
