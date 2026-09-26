import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { config } from './config';
import { logger } from './utils/logger';
import { prisma } from './utils/db';
import { authRouter, authMiddleware } from './middleware/auth';
import { errorHandler } from './middleware/error-handler';
import { campaignRouter } from './modules/campaign';
import { dashboardRouter } from './modules/dashboard';
import { getBot } from './modules/telegram-bot';
import { startWorkers, startScheduler } from './queues';

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
      connectSrc: ["'self'"],
    },
  },
  hsts: false,
}));
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use('/api/', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
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

app.use('/api/campaigns', authMiddleware, campaignRouter);
app.use('/api/dashboard', authMiddleware, dashboardRouter);

app.use(express.static(path.join(__dirname, '../public')));
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.use(errorHandler);

async function main() {
  try {
    await prisma.$connect();
    logger.info('Database connected');

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

    const server = app.listen(config.port, () => {
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
