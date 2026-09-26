import { PrismaClient } from '@prisma/client';
import { extractCleanText } from '../src/utils/clean-text';
const prisma = new PrismaClient();

async function main() {
  const items = await prisma.contentItem.findMany({
    where: { generatedText: { not: null } },
  });

  let fixed = 0;
  for (const item of items) {
    if (!item.generatedText) continue;
    const clean = extractCleanText(item.generatedText);
    if (clean !== item.generatedText) {
      await prisma.contentItem.update({
        where: { id: item.id },
        data: { generatedText: clean },
      });
      console.log(`Fixed: ${item.id} - ${item.topic}`);
      fixed++;
    }
  }
  console.log(`Done. Fixed ${fixed}/${items.length} items.`);
  await prisma.$disconnect();
}

main();
