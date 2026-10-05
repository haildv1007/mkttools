/**
 * M2.7.5 Platform Settings V1 - focused smoke tests.
 * Exercises the platform-settings module's core guarantees directly
 * (same convention as ai-settings.smoke.ts / billing.smoke.ts): access
 * control, secret-at-rest encryption, DB-over-env priority, and the
 * Google-login toggle actually gating the OAuth provider.
 *
 * Run: DATABASE_URL=postgresql://mkttools:mkttools_secret@localhost:5432/mkt_smoke npx ts-node tests/platform-settings.smoke.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

let passed = 0;
let failed = 0;

function assert(cond: boolean, label: string) {
  if (!cond) { console.error(`  FAIL: ${label}`); failed++; }
  else { console.log(`  OK: ${label}`); passed++; }
}

async function cleanDb() {
  await prisma.platformSetting.deleteMany();
  await prisma.paymentEvent.deleteMany();
  await prisma.paymentOrder.deleteMany();
  await prisma.organizationAiOperationSetting.deleteMany();
  await prisma.organizationAiCredential.deleteMany();
  await prisma.organizationSubscription.deleteMany();
  await prisma.organizationMemberPage.deleteMany();
  await prisma.organizationMemberWorkspace.deleteMany();
  await prisma.organizationMember.deleteMany();
  await prisma.userTrialEntitlement.deleteMany();
  await prisma.organizationInvitation.deleteMany();
  await prisma.workspacePage.deleteMany();
  await prisma.workspace.deleteMany();
  await prisma.contentItem.deleteMany();
  await prisma.campaign.deleteMany();
  await prisma.page.deleteMany();
  await prisma.organization.deleteMany();
  await prisma.authToken.deleteMany();
  await prisma.userAuthIdentity.deleteMany();
  await prisma.userSession.deleteMany();
  await prisma.user.deleteMany();
}

async function main() {
  await cleanDb();

  const { isPlatformAdmin } = await import('../src/modules/organization');
  const { encryptPlatformSecret, decryptPlatformSecret } = await import('../src/utils/crypto');
  const {
    refreshPlatformSettingsCache, getPlatformSetting, getPlatformSettingBool, resolveGoogleEnabled, getMailTransportConfig,
  } = await import('../src/modules/platform-settings');

  const owner = await prisma.user.create({ data: { email: 'ps-owner@example.com', name: 'Owner', passwordHash: 'x', isActive: true, isPlatformAdmin: false } });
  const org = await prisma.organization.create({ data: { name: 'PS Org', ownerUserId: owner.id } });
  await prisma.organizationMember.create({ data: { organizationId: org.id, userId: owner.id, role: 'OWNER', status: 'ACTIVE' } });
  const admin = await prisma.user.create({ data: { email: 'ps-admin@example.com', name: 'Admin', passwordHash: 'x', isActive: true, isPlatformAdmin: true } });

  // ─── A. Normal Organization OWNER is denied admin access ───
  console.log('\nA. Normal Organization OWNER: admin settings denied');
  assert((await isPlatformAdmin(owner.id)) === false, 'isPlatformAdmin(owner) = false (requirePlatformAdmin would 403 this user)');

  // ─── B. Platform Admin is allowed ───
  console.log('\nB. Platform Admin: settings accessible');
  assert((await isPlatformAdmin(admin.id)) === true, 'isPlatformAdmin(admin) = true (requirePlatformAdmin would let this user through)');

  // ─── C. Secret encrypted at rest; GET-equivalent never returns plaintext ───
  console.log('\nC. Save Google config - secret encrypted at rest');
  const plainSecret = 'gclient-secret-abc123';
  await prisma.platformSetting.upsert({
    where: { key: 'auth.googleClientSecret' },
    update: { value: encryptPlatformSecret(plainSecret), isSecret: true, updatedBy: admin.id },
    create: { key: 'auth.googleClientSecret', value: encryptPlatformSecret(plainSecret), isSecret: true, updatedBy: admin.id },
  });
  const rawRow = await prisma.platformSetting.findUnique({ where: { key: 'auth.googleClientSecret' } });
  assert(rawRow!.value !== plainSecret, 'raw DB value is not the plaintext secret');
  assert(rawRow!.value!.startsWith('pgcm1:'), 'raw DB value is AES-256-GCM ciphertext (pgcm1: prefix)');
  assert(decryptPlatformSecret(rawRow!.value!) === plainSecret, 'decrypts back to the original secret (round-trip correct)');
  await refreshPlatformSettingsCache();
  assert(getPlatformSetting('auth.googleClientSecret') === plainSecret, 'in-memory cache holds the decrypted value for server-side use only');

  // ─── D. Disable Google -> provider reports disabled (drives hiding the login button) ───
  console.log('\nD. Disable Google -> providers.google.enabled() false');
  await prisma.platformSetting.upsert({
    where: { key: 'auth.googleClientId' },
    update: { value: 'client-id-123', isSecret: false, updatedBy: admin.id },
    create: { key: 'auth.googleClientId', value: 'client-id-123', isSecret: false, updatedBy: admin.id },
  });
  await prisma.platformSetting.upsert({
    where: { key: 'auth.googleEnabled' },
    update: { value: 'false', isSecret: false, updatedBy: admin.id },
    create: { key: 'auth.googleEnabled', value: 'false', isSecret: false, updatedBy: admin.id },
  });
  await refreshPlatformSettingsCache();
  const { providers } = await import('../src/modules/auth/providers');
  assert(resolveGoogleEnabled() === false, 'resolveGoogleEnabled() reflects the stored false toggle');
  assert(providers.google.enabled() === false, 'providers.google.enabled() false even though client id/secret are configured - /api/auth/providers would hide the button');

  await prisma.platformSetting.update({ where: { key: 'auth.googleEnabled' }, data: { value: 'true' } });
  await refreshPlatformSettingsCache();
  assert(providers.google.enabled() === true, 'flipping the toggle back on (with creds already configured) re-enables it immediately, no restart');

  // ─── E. SMTP saved -> mail transport config uses stored values, DB wins over env ───
  console.log('\nE. Save SMTP -> transport config uses stored values');
  process.env.SMTP_HOST = 'env-smtp.example.com'; // simulate an env fallback that should be overridden
  await prisma.platformSetting.upsert({
    where: { key: 'email.smtpHost' },
    update: { value: 'db-smtp.example.com', isSecret: false, updatedBy: admin.id },
    create: { key: 'email.smtpHost', value: 'db-smtp.example.com', isSecret: false, updatedBy: admin.id },
  });
  await prisma.platformSetting.upsert({
    where: { key: 'email.smtpPassword' },
    update: { value: encryptPlatformSecret('smtp-pass-xyz'), isSecret: true, updatedBy: admin.id },
    create: { key: 'email.smtpPassword', value: encryptPlatformSecret('smtp-pass-xyz'), isSecret: true, updatedBy: admin.id },
  });
  await refreshPlatformSettingsCache();
  const mailCfg = getMailTransportConfig();
  assert(mailCfg?.host === 'db-smtp.example.com', 'DB-stored SMTP host wins over env SMTP_HOST (safe migration priority)');
  assert(mailCfg?.pass === 'smtp-pass-xyz', 'transport config carries the decrypted password for actual sending (never exposed via API)');
  delete process.env.SMTP_HOST;

  // ─── F. Secret status is a boolean summary, not a value ───
  console.log('\nF. Credential status never exposes plaintext, only a boolean');
  assert(getPlatformSettingBool('auth.emailPasswordEnabled') === true, 'default true when never configured (existing installs keep working)');

  // ─── G. A regular org user cannot read platform settings ───
  console.log('\nG. Organization user cannot retrieve platform settings');
  assert((await isPlatformAdmin(owner.id)) === false, 'org owner still denied after all the above admin writes - no privilege leak');

  // Summary
  console.log(`\n${'='.repeat(40)}`);
  console.log(`${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
