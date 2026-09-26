import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash('admin123', 12);

  const admin = await prisma.user.upsert({
    where: { email: 'admin@mkttools.local' },
    update: { passwordHash },
    create: {
      email: 'admin@mkttools.local',
      name: 'Admin',
      passwordHash,
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
