import express from 'express';
import { createServer } from 'http';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { readFileSync } from 'fs';
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
import { billingPublicRouter, billingCustomerRouter, billingAdminRouter, billingWebhookRouter } from './modules/billing';
import { facebookRouter } from './modules/facebook';
import { getPlatformSetting, refreshPlatformSettingsCache } from './modules/platform-settings';
import { getBot } from './modules/telegram-bot';
import { startWorkers, startScheduler } from './queues';
import { initSocketIO } from './realtime';
import { getPublishedContentMetadata, listPublishedContentEntries, publicContentRouter } from './modules/public-content';
import { buildRobotsTxt, buildSitemapXml, getPageSeo, getPublicSeoConfig, renderPublicDocument } from './modules/seo';

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
app.use('/api/public-content', publicContentRouter);

// Compatibility callback for the Google Console URI used by production.
// Redirecting into /api/auth also makes the path-scoped OAuth cookie available.
app.get('/auth/google/callback', (req, res) => {
  const query = new URLSearchParams();
  for (const key of ['code', 'state', 'error', 'error_description']) {
    const value = req.query[key];
    if (typeof value === 'string') query.set(key, value);
  }
  res.redirect(`/api/auth/google/callback?${query.toString()}`);
});

app.use('/api/billing', billingPublicRouter);
app.use('/api/payments', billingWebhookRouter);
app.use('/api/admin', authMiddleware, adminRouter);
app.use('/api/organizations', authMiddleware, organizationRouter);
app.use('/api/ai-credentials', authMiddleware, attachOrganization, requireOrganization, aiCredentialRouter);
app.use('/api/invitations', publicInvitationRouter);
app.use('/api/organizations-invitations', authMiddleware, attachOrganization, requireOrganization, organizationInvitationRouter);
app.use('/api/billing', authMiddleware, attachOrganization, requireOrganization, billingCustomerRouter);
app.use('/api/campaigns', authMiddleware, attachOrganization, requireOrganization, campaignRouter);
app.use('/api/dashboard', authMiddleware, attachOrganization, requireOrganization, dashboardRouter);
app.use('/api/facebook', authMiddleware, attachOrganization, requireOrganization, facebookRouter);
app.use('/api/workspaces', authMiddleware, attachOrganization, requireOrganization, workspaceRouter);

app.get('/robots.txt', (_req, res) => {
  const seo = getPublicSeoConfig();
  res.type('text/plain').send(buildRobotsTxt(seo));
});

// Public, non-secret branding used by the static authenticated/auth/admin shells.
app.get('/api/platform-config', (_req, res) => {
  const productName = (getPlatformSetting('general.productName') || 'MKT Tools').replace(/[\u2014\u2013]/g, '-');
  const safeUrl = (key: string): string => {
    const value = getPlatformSetting(key).trim();
    if (!value) return '';
    try {
      const parsed = new URL(value);
      return ['http:', 'https:'].includes(parsed.protocol) ? parsed.toString() : '';
    } catch { return ''; }
  };
  res.json({
    productName,
    support: {
      enabled: ['true', '1'].includes(getPlatformSetting('support.enabled')),
      title: getPlatformSetting('support.title'),
      subtitle: getPlatformSetting('support.subtitle'),
      channels: [
        { id: 'messenger', enabled: ['true', '1'].includes(getPlatformSetting('support.messengerEnabled')), label: getPlatformSetting('support.messengerLabel'), url: safeUrl('support.messengerUrl') },
        { id: 'telegram', enabled: ['true', '1'].includes(getPlatformSetting('support.telegramEnabled')), label: getPlatformSetting('support.telegramLabel'), url: safeUrl('support.telegramUrl') },
        { id: 'zalo', enabled: ['true', '1'].includes(getPlatformSetting('support.zaloEnabled')), label: getPlatformSetting('support.zaloLabel'), url: safeUrl('support.zaloUrl') },
      ],
    },
  });
});
app.get('/sitemap.xml', async (_req, res) => {
  const [posts, guides] = await Promise.all([
    listPublishedContentEntries('blog'),
    listPublishedContentEntries('guides'),
  ]);
  const paths = [
    '/', '/products', '/products/mkt-tools', ...(posts.length ? ['/blog'] : []), '/guides', '/support',
    '/legal/terms', '/legal/privacy', '/legal/data-deletion', '/legal/data-deletion/mkt-tools',
    ...posts.map((entry: any) => `/blog/${entry.slug}`),
    ...guides.map((entry: any) => `/guides/${entry.slug}`),
  ];
  const origin = getPublicSeoConfig().canonicalBaseUrl;
  res.type('application/xml').send(buildSitemapXml(paths, origin));
});

const noindex = (_req: express.Request, res: express.Response, next: express.NextFunction) => {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  next();
};
app.use([
  '/login', '/register', '/forgot-password', '/reset-password', '/verify-email', '/auth/callback', '/onboarding', '/join',
  '/admin', '/dashboard', '/organization', '/settings', '/content', '/campaigns', '/import', '/pages', '/billing', '/account',
], noindex);
// Do not redirect the /pages application route to the public/pages asset directory.
app.use(express.static(path.join(__dirname, '../public'), {
  redirect: false,
  index: false,
  setHeaders(res, filePath) {
    // App shell assets change independently of their stable filenames. Force
    // browsers/CDNs to revalidate so a deploy cannot leave an open tab running
    // stale dashboard logic for hours.
    if (/\.(?:html|js|css)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'public, no-cache, must-revalidate');
    }
  },
}));
const authPage = (_req: express.Request, res: express.Response) => res.sendFile(path.join(__dirname, '../public/auth.html'));
app.get(['/login', '/register', '/forgot-password', '/reset-password/:token', '/verify-email/:token', '/auth/callback', '/onboarding', '/join/:token'], authPage);
app.get(['/admin', '/admin/*'], (_req, res) => {
  res.sendFile(path.join(__dirname, '../public/admin.html'));
});
app.get('/billing', (_req, res) => {
  res.redirect('/organization?tab=billing');
});
const publicTemplate = readFileSync(path.join(process.cwd(), 'public/mktkit/index.html'), 'utf8');
const publicWebsitePage = (req: express.Request, res: express.Response) => {
  const seo = getPublicSeoConfig();
  res.send(renderPublicDocument(publicTemplate, getPageSeo(req.path), seo));
};
const publicContentPage = async (req: express.Request, res: express.Response) => {
  const kind = req.path.startsWith('/blog/') ? 'blog' : 'guides';
  const slug = String(req.params.slug || '');
  const entry = await getPublishedContentMetadata(kind, slug);
  const page = entry
    ? { path: req.path, title: `${entry.title} - {{siteName}}`, description: entry.description, type: 'article' as const }
    : { path: req.path, title: 'Nội dung không tồn tại - {{siteName}}', description: 'Nội dung không tồn tại hoặc chưa được xuất bản.', noindex: true };
  if (!entry) res.status(404);
  res.send(renderPublicDocument(publicTemplate, page));
};
app.get([
  '/',
  '/products',
  '/products/mkt-tools',
  '/blog',
  '/guides',
  '/support',
  '/legal/terms',
  '/legal/privacy',
  '/legal/data-deletion',
  '/legal/data-deletion/mkt-tools',
], publicWebsitePage);
app.get(['/blog/:slug', '/guides/:slug'], publicContentPage);
app.get('/mktkit*', (_req, res) => res.redirect(301, '/'));
app.get('*', (_req, res) => {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
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
