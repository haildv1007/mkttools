import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import { config } from './config';
import { campaignRouter } from './modules/campaign';
import { dashboardRouter } from './modules/dashboard';
import { getBot } from './modules/telegram-bot';
import { startWorkers, startScheduler } from './queues';

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use('/api/campaigns', campaignRouter);
app.use('/api/dashboard', dashboardRouter);

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use(express.static(path.join(__dirname, '../public')));

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

async function main() {
  try {
    if (config.telegram.botToken) {
      getBot();
      console.log('Telegram bot started');
    }

    if (config.redis.url) {
      startWorkers();
      await startScheduler();
    }

    app.listen(config.port, () => {
      console.log(`MKT Tools API running on port ${config.port}`);
    });
  } catch (err) {
    console.error('Failed to start:', err);
    process.exit(1);
  }
}

main();
