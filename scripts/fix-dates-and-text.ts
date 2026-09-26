import { PrismaClient } from '@prisma/client';
import { extractCleanText } from '../src/utils/clean-text';
const prisma = new PrismaClient();

async function main() {
  const items = await prisma.contentItem.findMany({
    include: { page: true },
  });

  let fixedText = 0;
  let fixedDate = 0;

  for (const item of items) {
    const updates: Record<string, unknown> = {};

    // Fix raw JSON in generatedText
    if (item.generatedText) {
      const clean = extractCleanText(item.generatedText);
      if (clean !== item.generatedText) {
        updates.generatedText = clean;
        fixedText++;
      }
    }

    // Fix wrong year (2028 → keep month/day but use current year or next)
    const sa = item.scheduledAt;
    if (sa.getFullYear() === 2028) {
      const now = new Date();
      const fixed = new Date(sa);
      fixed.setFullYear(now.getFullYear());
      // If the date is already far in the past this year, leave as-is
      updates.scheduledAt = fixed;
      fixedDate++;
    }

    if (Object.keys(updates).length > 0) {
      await prisma.contentItem.update({
        where: { id: item.id },
        data: updates,
      });
      console.log(`Fixed ${item.id.slice(-6)}: ${Object.keys(updates).join(', ')} - ${item.topic}`);
    }
  }

  console.log(`\nDone. Fixed text: ${fixedText}, Fixed dates: ${fixedDate} / ${items.length} total items.`);
  await prisma.$disconnect();
}

main();
