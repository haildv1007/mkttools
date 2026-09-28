import { prisma } from './db';
import { logger } from './logger';

type Category = 'content' | 'publish' | 'bulk' | 'import' | 'system';
type Status = 'running' | 'success' | 'error';

interface LogOptions {
  action: string;
  category: Category;
  summary: string;
  detail?: string;
  entityType?: string;
  entityId?: string;
  entityLabel?: string;
  progress?: number;
  total?: number;
  status?: Status;
  errorCode?: string;
}

const SAFE_ERROR_MAP: Record<string, string> = {
  ECONNREFUSED: 'Không thể kết nối dịch vụ',
  ETIMEDOUT: 'Hết thời gian chờ',
  ENOTFOUND: 'Không tìm thấy máy chủ',
  'OAuthException': 'Lỗi xác thực Facebook',
  'GraphMethodException': 'Lỗi API Facebook',
  'NETWORK_ERROR': 'Lỗi kết nối mạng',
};

export function sanitizeError(err: unknown): { message: string; code: string } {
  if (!err) return { message: 'Lỗi không xác định', code: 'UNKNOWN' };
  const msg = err instanceof Error ? err.message : String(err);
  for (const [key, safe] of Object.entries(SAFE_ERROR_MAP)) {
    if (msg.includes(key)) return { message: safe, code: key };
  }
  const clean = msg
    .replace(/access_token=[^\s&]+/gi, 'access_token=***')
    .replace(/Bearer\s+[^\s]+/gi, 'Bearer ***')
    .replace(/https?:\/\/[^\s]+/gi, '[URL]')
    .replace(/at\s+\S+\s+\(\S+:\d+:\d+\)/g, '')
    .slice(0, 200);
  return { message: clean || 'Lỗi hệ thống', code: 'INTERNAL' };
}

export async function logActivity(opts: LogOptions): Promise<string> {
  try {
    const record = await prisma.activityLog.create({
      data: {
        action: opts.action,
        category: opts.category,
        status: opts.status || 'running',
        summary: opts.summary.slice(0, 500),
        detail: opts.detail?.slice(0, 1000),
        entityType: opts.entityType,
        entityId: opts.entityId,
        entityLabel: opts.entityLabel?.slice(0, 200),
        progress: opts.progress,
        total: opts.total,
        errorCode: opts.errorCode,
      },
    });
    return record.id;
  } catch (e) {
    logger.error({ err: e }, 'Failed to write activity log');
    return '';
  }
}

export async function updateActivity(id: string, data: Partial<Pick<LogOptions, 'status' | 'summary' | 'detail' | 'progress' | 'total' | 'errorCode'>>) {
  if (!id) return;
  try {
    await prisma.activityLog.update({
      where: { id },
      data: {
        status: data.status,
        summary: data.summary?.slice(0, 500),
        detail: data.detail?.slice(0, 1000),
        progress: data.progress,
        total: data.total,
        errorCode: data.errorCode,
      },
    });
  } catch (e) {
    logger.error({ err: e }, 'Failed to update activity log');
  }
}
