import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

function extractCleanText(raw: string): string {
  try {
    let cleaned = raw.trim();
    const jsonMatch = cleaned.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
    if (jsonMatch) cleaned = jsonMatch[1].trim();
    const parsed = JSON.parse(cleaned);
    if (parsed.text) {
      let text = parsed.text;
      if (parsed.hashtags?.length) {
        text += '\n\n' + parsed.hashtags.map((h: string) => `#${String(h).replace(/^#/, '')}`).join(' ');
      }
      if (parsed.cta) text += '\n\n' + parsed.cta;
      return text;
    }
  } catch {}
  return raw;
}

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
