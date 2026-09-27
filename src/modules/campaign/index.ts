import { Router, Request, Response } from 'express';
import multer from 'multer';
import { prisma } from '../../utils/db';
import { parseExcelToSchedule } from './excel-parser';
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const router = Router();

router.post('/import', upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const { campaignName, userId } = req.body;
    if (!campaignName || !userId) {
      return res.status(400).json({ error: 'campaignName and userId required' });
    }

    const rows = parseExcelToSchedule(req.file.buffer);
    console.log('[Import] Parsed rows:', rows.map(r => ({
      topic: r.topic,
      rawDate: String(r.rawDate),
      rawTime: String(r.rawTime),
      scheduledAt: r.scheduledAt.toISOString(),
      scheduledAtVN: r.scheduledAt.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }),
    })));
    if (rows.length === 0) return res.status(400).json({ error: 'No valid rows in file' });

    const pageNames = [...new Set(rows.map(r => r.page).filter(Boolean))];
    const pages = await prisma.page.findMany({
      where: { name: { in: pageNames }, isActive: true },
    });
    const pageMap = new Map(pages.map(p => [p.name, p.id]));

    const campaign = await prisma.campaign.create({
      data: {
        name: campaignName,
        startDate: rows[0].scheduledAt,
        endDate: rows[rows.length - 1].scheduledAt,
        userId,
      },
    });

    let created = 0;
    let skipped = 0;
    for (const row of rows) {
      const pageId = pageMap.get(row.page);
      if (!pageId) { skipped++; continue; }

      const hasContent = !!(row.generatedText || row.imageUrl || row.videoUrl);
      await prisma.contentItem.create({
        data: {
          campaignId: campaign.id,
          pageId,
          scheduledAt: row.scheduledAt,
          topic: row.topic,
          notes: row.notes,
          contentType: row.contentType,
          imageDescriptions: row.imageDescriptions || null,
          generatedText: row.generatedText || null,
          generatedImageUrl: row.imageUrl || null,
          generatedVideoUrl: row.videoUrl || null,
          source: 'IMPORT',
          status: hasContent ? 'PENDING_REVIEW' : 'DRAFT',
        },
      });
      created++;
    }

    res.json({
      success: true,
      campaign: { id: campaign.id, name: campaign.name },
      stats: { total: rows.length, created, skipped },
      unmatchedPages: pageNames.filter(n => !pageMap.has(n)),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

router.get('/', async (_req: Request, res: Response) => {
  const campaigns = await prisma.campaign.findMany({
    include: { _count: { select: { contentItems: true } } },
    orderBy: { createdAt: 'desc' },
  });
  res.json(campaigns);
});

router.get('/:id', async (req: Request, res: Response) => {
  const campaign = await prisma.campaign.findUnique({
    where: { id: String(req.params.id) },
    include: {
      contentItems: {
        include: { page: true },
        orderBy: { scheduledAt: 'asc' },
      },
    },
  });
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
  res.json(campaign);
});

router.delete('/:id', async (req: Request, res: Response) => {
  await prisma.contentItem.deleteMany({ where: { campaignId: String(req.params.id) } });
  await prisma.campaign.delete({ where: { id: String(req.params.id) } });
  res.json({ success: true });
});

export { router as campaignRouter };
