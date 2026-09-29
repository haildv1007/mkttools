import { Router, Request, Response } from 'express';
import multer from 'multer';
import * as XLSX from 'xlsx';
import { prisma } from '../../utils/db';
import { parseExcelToSchedule } from './excel-parser';
import { resolvePageIds } from '../workspace';
import { AuthRequest } from '../../middleware/auth';

async function assertPageInOrg(pageId: string, orgId: string) {
  const page = await prisma.page.findUnique({ where: { id: pageId }, select: { organizationId: true } });
  if (!page || page.organizationId !== orgId) {
    const err = new Error('Page not found') as Error & { status?: number };
    err.status = 404;
    throw err;
  }
}
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const router = Router();

router.get('/template', (req: Request, res: Response) => {
  const type = req.query.type === 'ai' ? 'ai' : 'ready';
  let headers: string[];
  let examples: string[][];
  let filename: string;

  if (type === 'ai') {
    headers = ['Ngày', 'Giờ đăng', 'Chủ đề', 'Loại', 'Ghi chú', 'Mô tả ảnh (mỗi ảnh cách bằng dấu |)'];
    examples = [
      ['2026-10-01', '09:00', 'Khuyến mãi mùa thu - Giảm 50%', 'image', 'Tone vui vẻ, có emoji', 'Banner sale 50% nền cam rực rỡ'],
      ['2026-10-02', '18:00', 'Review áo khoác mới về', 'image', 'Phong cách review chân thực', 'Flat lay áo khoác trên nền gỗ | Model nữ mặc áo khoác trên phố'],
      ['2026-10-03', '10:00', 'Combo tiết kiệm mùa đông', 'image', 'Nhấn mạnh giá hời', 'Ảnh 3 sản phẩm combo xếp cạnh nhau'],
      ['2026-10-04', '12:00', 'Tips phối đồ mùa thu', 'text', 'Dạng listicle, 5 tips ngắn gọn', ''],
    ];
    filename = 'mkttools-ai-gen.xlsx';
  } else {
    headers = ['Ngày', 'Giờ đăng', 'Chủ đề', 'Loại', 'Bài viết', 'Link ảnh', 'Link video'];
    examples = [
      ['2026-10-01', '09:00', 'Flash Sale cuối tuần', 'image', 'Flash Sale cực sốc! 🔥 Giảm đến 70%!', 'https://example.com/sale.jpg', ''],
      ['2026-10-02', '20:00', 'Unbox hàng mới về', 'video', 'Unbox lô hàng mới! Xem ngay 👀', '', 'https://example.com/unbox.mp4'],
      ['2026-10-03', '10:00', 'Feedback khách hàng', 'image', 'Cảm ơn chị đã tin tưởng shop 🥰', 'https://example.com/review.jpg', ''],
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

router.post('/import', upload.single('file'), async (req: AuthRequest, res: Response) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const { pageId, campaignId, campaignName } = req.body;
    const userId = req.body.userId || req.userId;
    if (!pageId || !userId) {
      return res.status(400).json({ error: 'pageId and userId required' });
    }
    await assertPageInOrg(pageId, req.organizationId!);

    const rows = parseExcelToSchedule(req.file.buffer);
    if (rows.length === 0) return res.status(400).json({ error: 'No valid rows in file' });

    let campaign: { id: string; name: string };
    if (campaignId) {
      const existing = await prisma.campaign.findUnique({ where: { id: campaignId } });
      if (!existing || existing.organizationId !== req.organizationId) {
        return res.status(404).json({ error: 'Campaign not found' });
      }
      campaign = existing;
    } else {
      const name = campaignName || `Import ${new Date().toLocaleDateString('vi-VN')}`;
      campaign = await prisma.campaign.create({
        data: {
          organizationId: req.organizationId!,
          name,
          pageId,
          startDate: rows[0].scheduledAt,
          endDate: rows[rows.length - 1].scheduledAt,
          userId,
        },
      });
    }

    let created = 0;
    for (const row of rows) {
      const hasContent = !!(row.generatedText || row.imageUrl || row.videoUrl);
      await prisma.contentItem.create({
        data: {
          organizationId: req.organizationId!,
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
      stats: { total: rows.length, created },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

router.get('/', async (req: AuthRequest, res: Response) => {
  const { scopeType, scopeId, pageId } = req.query;

  const where: Record<string, unknown> = { organizationId: req.organizationId };

  if (pageId) {
    where.pageId = String(pageId);
  } else if (scopeType && scopeType !== 'all') {
    const scopePageIds = await resolvePageIds(String(scopeType), scopeId ? String(scopeId) : undefined, req.organizationId!);
    where.pageId = { in: scopePageIds.length ? scopePageIds : ['__none__'] };
  }

  const campaigns = await prisma.campaign.findMany({
    where,
    include: {
      page: { select: { id: true, name: true, platform: true, externalId: true } },
      _count: { select: { contentItems: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
  res.json(campaigns);
});

router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const { name, description, pageId, startDate, endDate, genLeadTime, autoApprove } = req.body;
    const userId = req.body.userId || req.userId;
    if (!name || !pageId) return res.status(400).json({ error: 'name and pageId required' });
    await assertPageInOrg(pageId, req.organizationId!);
    const campaign = await prisma.campaign.create({
      data: {
        organizationId: req.organizationId!,
        name,
        description: description || null,
        pageId,
        startDate: startDate ? new Date(startDate) : new Date(),
        endDate: endDate ? new Date(endDate) : null,
        genLeadTime: genLeadTime ?? 30,
        autoApprove: autoApprove ?? false,
        userId,
      },
      include: {
        page: { select: { id: true, name: true, platform: true, externalId: true } },
        _count: { select: { contentItems: true } },
      },
    });
    res.json(campaign);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to create campaign' });
  }
});

router.get('/:id', async (req: AuthRequest, res: Response) => {
  const campaign = await prisma.campaign.findUnique({
    where: { id: String(req.params.id) },
    include: {
      page: { select: { id: true, name: true, platform: true, externalId: true } },
      contentItems: {
        include: { page: true },
        orderBy: { scheduledAt: 'asc' },
      },
    },
  });
  if (!campaign || campaign.organizationId !== req.organizationId) return res.status(404).json({ error: 'Campaign not found' });
  res.json(campaign);
});

router.put('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const id = String(req.params.id);
    const existing = await prisma.campaign.findUnique({ where: { id } });
    if (!existing || existing.organizationId !== req.organizationId) return res.status(404).json({ error: 'Campaign not found' });
    const { name, description, genLeadTime, autoApprove, startDate, endDate } = req.body;
    const data: Record<string, unknown> = {};
    if (name !== undefined) data.name = name;
    if (description !== undefined) data.description = description;
    if (genLeadTime !== undefined) data.genLeadTime = Number(genLeadTime);
    if (autoApprove !== undefined) data.autoApprove = Boolean(autoApprove);
    if (startDate !== undefined) data.startDate = new Date(startDate);
    if (endDate !== undefined) data.endDate = endDate ? new Date(endDate) : null;
    const campaign = await prisma.campaign.update({
      where: { id },
      data,
      include: {
        page: { select: { id: true, name: true, platform: true, externalId: true } },
        _count: { select: { contentItems: true } },
      },
    });
    res.json(campaign);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to update campaign' });
  }
});

router.delete('/:id', async (req: AuthRequest, res: Response) => {
  const id = String(req.params.id);
  const existing = await prisma.campaign.findUnique({ where: { id } });
  if (!existing || existing.organizationId !== req.organizationId) return res.status(404).json({ error: 'Campaign not found' });
  await prisma.contentItem.deleteMany({ where: { campaignId: id } });
  await prisma.campaign.delete({ where: { id } });
  res.json({ success: true });
});

export { router as campaignRouter };
