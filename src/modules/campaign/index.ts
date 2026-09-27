import { Router, Request, Response } from 'express';
import multer from 'multer';
import * as XLSX from 'xlsx';
import { prisma } from '../../utils/db';
import { parseExcelToSchedule } from './excel-parser';
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const router = Router();

router.get('/template', (req: Request, res: Response) => {
  const type = req.query.type === 'ai' ? 'ai' : 'ready';
  let headers: string[];
  let examples: string[][];
  let filename: string;

  if (type === 'ai') {
    headers = ['Ngày', 'Giờ đăng', 'Page', 'Chủ đề', 'Loại', 'Ghi chú', 'Mô tả ảnh'];
    examples = [
      ['2026-10-01', '09:00', 'Shop ABC', 'Khuyến mãi mùa thu - Giảm 50%', 'image', 'Tone vui vẻ, có emoji, nhấn mạnh urgency', 'Ảnh sản phẩm thu đông'],
      ['2026-10-02', '18:00', 'Shop ABC', 'Review áo khoác mới về', 'image', 'Phong cách review chân thực', 'Flat lay áo khoác | Model mặc thử'],
      ['2026-10-03', '12:00', 'Shop ABC', 'Tips phối đồ mùa thu', 'text', 'Dạng listicle, 5 tips ngắn gọn', ''],
    ];
    filename = 'mkttools-ai-gen.xlsx';
  } else {
    headers = ['Ngày', 'Giờ đăng', 'Page', 'Chủ đề', 'Loại', 'Bài viết', 'Link ảnh', 'Link video'];
    examples = [
      ['2026-10-01', '09:00', 'Shop ABC', 'Flash Sale cuối tuần', 'image', 'Flash Sale cực sốc! 🔥 Giảm đến 70% toàn bộ sản phẩm. Chỉ 2 ngày!', 'https://example.com/sale.jpg', ''],
      ['2026-10-02', '20:00', 'Shop ABC', 'Unbox hàng mới về', 'video', 'Unbox lô hàng mới! Xem ngay 👀 #fashion #newcollection', '', 'https://example.com/unbox.mp4'],
      ['2026-10-03', '10:00', 'Shop ABC', 'Feedback khách hàng', 'image', 'Cảm ơn chị đã tin tưởng shop ạ 🥰 #review #feedback', 'https://example.com/review.jpg', ''],
    ];
    filename = 'mkttools-co-san.xlsx';
  }

  const ws = XLSX.utils.aoa_to_sheet([headers, ...examples]);
  ws['!cols'] = headers.map(h => ({ wch: h === 'Bài viết' ? 50 : h === 'Chủ đề' || h === 'Ghi chú' ? 35 : 20 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Template');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buf);
});

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
      const isManualSource = row.source?.includes('sẵn') || row.source?.includes('san') || row.source === 'manual' || row.source === 'có sẵn';
      const isAiSource = row.source === 'ai' || row.source?.includes('ai');
      const resolvedSource = isManualSource || (!isAiSource && hasContent) ? 'IMPORT' : 'IMPORT';
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
          source: resolvedSource,
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
