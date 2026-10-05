import { PrismaClient } from '@prisma/client';
import { generateThumbnail, getThumbnailUrl, thumbnailExists } from '../src/utils/thumbnail';

const prisma = new PrismaClient();

async function main() {
  const items = await prisma.contentItem.findMany({
    where: { generatedImageUrl: { not: null } },
    select: { id: true, generatedImageUrl: true },
  });

  let processed = 0;
  let created = 0;
  let skipped = 0;
  let failed = 0;

  for (const item of items) {
    processed++;
    const url = item.generatedImageUrl!;

    if (!url.startsWith('/uploads/')) {
      skipped++;
      continue;
    }

    if (thumbnailExists(url)) {
      skipped++;
      continue;
    }

    try {
      const result = await generateThumbnail(url);
      if (result) {
        created++;
        if (processed % 50 === 0) console.log(`Progress: ${processed}/${items.length}`);
      } else {
        skipped++;
      }
    } catch (err) {
      failed++;
      console.error(`Failed: ${url} — ${err instanceof Error ? err.message : err}`);
    }
  }

  console.log(`\nBackfill complete:`);
  console.log(`  Processed: ${processed}`);
  console.log(`  Created:   ${created}`);
  console.log(`  Skipped:   ${skipped}`);
  console.log(`  Failed:    ${failed}`);

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
