import { PrismaClient } from '@prisma/client';
import { createHash } from 'crypto';

const prisma = new PrismaClient();

function hashPassword(password: string): string {
  return createHash('sha256').update(password).digest('hex');
}

async function main() {
  const admin = await prisma.user.upsert({
    where: { email: 'admin@mkttools.local' },
    update: {},
    create: {
      email: 'admin@mkttools.local',
      name: 'Admin',
      passwordHash: hashPassword('admin123'),
      role: 'OWNER',
    },
  });

  console.log('Seeded admin user:', admin.email);

  const demoPage = await prisma.page.upsert({
    where: { platform_externalId: { platform: 'FACEBOOK', externalId: 'demo_page_123' } },
    update: {},
    create: {
      platform: 'FACEBOOK',
      name: 'Demo Page',
      externalId: 'demo_page_123',
      accessToken: 'demo_token',
      userId: admin.id,
    },
  });

  console.log('Seeded demo page:', demoPage.name);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
