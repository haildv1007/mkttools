import express from 'express';
import { createServer } from 'http';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { config } from './config';
import { logger } from './utils/logger';
import { prisma } from './utils/db';
import { authMiddleware, attachOrganization, requireOrganization } from './middleware/auth';
import { authRouter } from './modules/auth';
import { errorHandler } from './middleware/error-handler';
import { campaignRouter } from './modules/campaign';
import { dashboardRouter } from './modules/dashboard';
import { workspaceRouter } from './modules/workspace';
import { organizationRouter } from './modules/organization';
import { adminRouter } from './modules/admin';
import { aiCredentialRouter } from './modules/ai-credentials';
import { organizationInvitationRouter, publicInvitationRouter } from './modules/invitations';
import { billingPublicRouter, billingCustomerRouter, billingAdminRouter } from './modules/billing';
import { refreshPlatformSettingsCache } from './modules/platform-settings';
import { getBot } from './modules/telegram-bot';
import { startWorkers, startScheduler } from './queues';
import { initSocketIO } from './realtime';

const app = express();
app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://cdn.tailwindcss.com", "https://cdn.jsdelivr.net"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdn.jsdelivr.net"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdn.jsdelivr.net"],
      imgSrc: ["'self'", "data:", "https:"],
      mediaSrc: ["'self'", "https:"],
      connectSrc: ["'self'", "ws:", "wss:"],
    },
  },
  hsts: false,
}));
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use('/api/', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
}));

app.get('/api/health', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok', timestamp: new Date().toISOString(), db: 'connected' });
  } catch {
    res.status(503).json({ status: 'error', db: 'disconnected' });
  }
});

app.use('/api/auth', authRouter);

app.use('/api/billing', billingPublicRouter);
app.use('/api/admin', authMiddleware, adminRouter);
app.use('/api/organizations', authMiddleware, organizationRouter);
app.use('/api/ai-credentials', authMiddleware, attachOrganization, requireOrganization, aiCredentialRouter);
app.use('/api/invitations', publicInvitationRouter);
app.use('/api/organizations-invitations', authMiddleware, attachOrganization, requireOrganization, organizationInvitationRouter);
app.use('/api/billing', authMiddleware, attachOrganization, requireOrganization, billingCustomerRouter);
app.use('/api/campaigns', authMiddleware, attachOrganization, requireOrganization, campaignRouter);
app.use('/api/dashboard', authMiddleware, attachOrganization, requireOrganization, dashboardRouter);
app.use('/api/workspaces', authMiddleware, attachOrganization, requireOrganization, workspaceRouter);

app.use(express.static(path.join(__dirname, '../public')));
const authPage = (_req: express.Request, res: express.Response) => res.sendFile(path.join(__dirname, '../public/auth.html'));
app.get(['/login', '/register', '/forgot-password', '/reset-password/:token', '/verify-email/:token', '/auth/callback', '/onboarding', '/join/:token'], authPage);
app.get(['/admin', '/admin/*'], (_req, res) => {
  res.sendFile(path.join(__dirname, '../public/admin.html'));
});
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.use(errorHandler);

async function main() {
  try {
    await prisma.$connect();
    logger.info('Database connected');

    await refreshPlatformSettingsCache();
    logger.info('Platform settings loaded');

    if (config.telegram.botToken) {
      getBot();
      logger.info('Telegram bot started');
    } else {
      logger.warn('TELEGRAM_BOT_TOKEN not set, bot disabled');
    }

    if (config.redis.url) {
      startWorkers();
      await startScheduler();
    } else {
      logger.warn('REDIS_URL not set, queue disabled');
    }

    const httpServer = createServer(app);
    initSocketIO(httpServer);

    const server = httpServer.listen(config.port, () => {
      logger.info({ port: config.port }, 'MKT Tools API running');
    });

    const shutdown = async (signal: string) => {
      logger.info({ signal }, 'Shutting down...');
      server.close();
      await prisma.$disconnect();
      process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  } catch (err) {
    logger.fatal({ err }, 'Failed to start');
    process.exit(1);
  }
}

main();
