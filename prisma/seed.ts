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

  // Ensure subscription plans exist
  const plans = [
    { code: 'STARTER_3', name: 'Starter', maxPages: 3, sortOrder: 10 },
    { code: 'BASIC_5', name: 'Basic', maxPages: 5, sortOrder: 20 },
    { code: 'PRO_10', name: 'Pro', maxPages: 10, sortOrder: 30 },
    { code: 'BUSINESS_20', name: 'Business', maxPages: 20, sortOrder: 40 },
    { code: 'AGENCY_50', name: 'Agency', maxPages: 50, sortOrder: 50 },
    { code: 'ENTERPRISE', name: 'Enterprise', maxPages: null as number | null, sortOrder: 60 },
  ];
  for (const p of plans) {
    await prisma.subscriptionPlan.upsert({
      where: { code: p.code },
      update: { name: p.name, maxPages: p.maxPages, sortOrder: p.sortOrder, isActive: true },
      create: { code: p.code, name: p.name, maxPages: p.maxPages, sortOrder: p.sortOrder, isActive: true },
    });
  }

  // Ensure default org
  const org = await prisma.organization.upsert({
    where: { id: 'org_default_mkttools' },
    update: {},
    create: {
      id: 'org_default_mkttools',
      name: 'MKT Tools',
      slug: 'mkt-tools',
      ownerUserId: admin.id,
      status: 'ACTIVE',
    },
  });

  await prisma.organizationMember.upsert({
    where: { organizationId_userId: { organizationId: org.id, userId: admin.id } },
    update: { role: 'OWNER', status: 'ACTIVE' },
    create: { organizationId: org.id, userId: admin.id, role: 'OWNER', status: 'ACTIVE' },
  });

  const enterprise = await prisma.subscriptionPlan.findUnique({ where: { code: 'ENTERPRISE' } });
  if (enterprise) {
    const existing = await prisma.organizationSubscription.findFirst({
      where: { organizationId: org.id, status: 'ACTIVE' },
    });
    if (!existing) {
      await prisma.organizationSubscription.create({
        data: { organizationId: org.id, planId: enterprise.id, status: 'ACTIVE' },
      });
    }
  }

  const demoPage = await prisma.page.upsert({
    where: { organizationId_platform_externalId: { organizationId: org.id, platform: 'FACEBOOK', externalId: 'demo_page_123' } },
    update: {},
    create: {
      organizationId: org.id,
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
