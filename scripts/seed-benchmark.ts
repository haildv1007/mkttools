import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Use the default org, and create a campaign if needed
  const org = await prisma.organization.findFirst({ where: { id: 'org_default_mkttools' } });
  if (!org) throw new Error('No organization found');
  const page = await prisma.page.findFirst({ where: { organizationId: org.id } });
  if (!page) throw new Error('No page found');
  let campaign = await prisma.campaign.findFirst({ where: { organizationId: org.id } });
  if (!campaign) {
    const user = await prisma.user.findFirst();
    if (!user) throw new Error('No user found');
    campaign = await prisma.campaign.create({
      data: {
        name: 'Benchmark Campaign',
        organization: { connect: { id: org.id } },
        page: { connect: { id: page.id } },
        user: { connect: { id: user.id } },
        isActive: true,
        startDate: new Date(),
      },
    });
    console.log('Created benchmark campaign:', campaign.id);
  }

  const statuses = ['DRAFT', 'QUEUED', 'GENERATING', 'PENDING_REVIEW', 'APPROVED', 'PUBLISHING', 'PUBLISHED', 'FAILED', 'CANCELLED'] as const;
  const sources = ['AI', 'MANUAL', 'IMPORT'] as const;
  const types = ['IMAGE', 'VIDEO', 'TEXT'] as const;

  const BATCH_SIZE = 100;
  const TOTAL = 1000;

  for (let batch = 0; batch < TOTAL / BATCH_SIZE; batch++) {
    const items = [];
    for (let i = 0; i < BATCH_SIZE; i++) {
      const idx = batch * BATCH_SIZE + i;
      const d = new Date();
      d.setDate(d.getDate() - Math.floor(Math.random() * 60));
      d.setHours(Math.floor(Math.random() * 24), Math.floor(Math.random() * 60));
      items.push({
        organizationId: org.id,
        pageId: page.id,
        campaignId: campaign.id,
        topic: `Benchmark content #${idx} - ${['Marketing tips', 'Product launch', 'Customer story', 'Industry news', 'How-to guide'][idx % 5]}`,
        scheduledAt: d,
        status: statuses[idx % statuses.length],
        source: sources[idx % sources.length],
        contentType: types[idx % types.length],
        generatedText: idx % 3 === 0 ? `Generated text for benchmark item ${idx}. Lorem ipsum dolor sit amet.` : null,
        generatedImageUrl: idx % 4 === 0 ? `/uploads/images/benchmark-${idx}.jpg` : null,
        metrics: idx % statuses.length === 6 ? { fb_reach: Math.floor(Math.random() * 10000), fb_media_views: Math.floor(Math.random() * 5000), fb_reactions: Math.floor(Math.random() * 500), fb_comments: Math.floor(Math.random() * 100), fb_shares: Math.floor(Math.random() * 50), fb_clicks: Math.floor(Math.random() * 200) } : null,
        publishedAt: idx % statuses.length === 6 ? d : null,
      });
    }
    await prisma.contentItem.createMany({ data: items as any });
    console.log(`Created batch ${batch + 1}/${TOTAL / BATCH_SIZE}`);
  }

  const total = await prisma.contentItem.count({ where: { organizationId: org.id } });
  console.log(`Total content items: ${total}`);
  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
