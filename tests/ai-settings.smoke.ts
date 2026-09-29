/**
 * AI Settings Consolidation + Generation Fix — focused smoke tests.
 * Exercises resolveGeneration() directly (the function content-generator's
 * generateText/generateImage now call) so we assert exactly which provider
 * and model a generation call would use, without hitting real provider APIs.
 *
 * Run: DATABASE_URL=postgresql://mkttools:mkttools_secret@localhost:5432/mkt_smoke npx ts-node tests/ai-settings.smoke.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

let passed = 0;
let failed = 0;

function assert(cond: boolean, label: string) {
  if (!cond) { console.error(`  FAIL: ${label}`); failed++; }
  else { console.log(`  OK: ${label}`); passed++; }
}

async function assertThrows(fn: () => Promise<unknown>, code: string, label: string) {
  try {
    await fn();
    console.error(`  FAIL: ${label} (did not throw)`); failed++;
  } catch (e: any) {
    if (e?.code === code) { console.log(`  OK: ${label}`); passed++; }
    else { console.error(`  FAIL: ${label} (expected code ${code}, got ${e?.code || e})`); failed++; }
  }
}

async function cleanDb() {
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

async function seedOrg(email: string, name: string) {
  const user = await prisma.user.create({ data: { email, name, passwordHash: 'x', isActive: true } });
  const org = await prisma.organization.create({ data: { name, ownerUserId: user.id } });
  await prisma.organizationMember.create({ data: { organizationId: org.id, userId: user.id, role: 'OWNER', status: 'ACTIVE' } });
  return { user, org };
}

async function main() {
  await cleanDb();
  const { org: orgA } = await seedOrg('ai-settings-a@example.com', 'AI Settings Org A');
  const { org: orgB } = await seedOrg('ai-settings-b@example.com', 'AI Settings Org B');

  const { resolveGeneration, AiProviderNotConfiguredError, credentialStatus } = await import('../src/modules/ai-credentials');
  const { encryptSecret, decryptSecret } = await import('../src/utils/crypto');

  // ─── A. Gemini text: explicit operation setting model always wins ───
  console.log('\nA. Gemini text — explicit model reaches resolution unchanged');
  await prisma.organizationAiCredential.create({
    data: { organizationId: orgA.id, provider: 'gemini', encryptedApiKey: encryptSecret('AIza-fake-key-org-a'), isActive: true },
  });
  await prisma.organizationAiOperationSetting.create({
    data: { organizationId: orgA.id, operation: 'TEXT_GENERATION', provider: 'gemini', model: 'gemini-2.5-flash' },
  });
  const resA = await resolveGeneration({ organizationId: orgA.id, operation: 'TEXT_GENERATION' });
  assert(resA.provider === 'gemini', 'provider = gemini');
  assert(resA.model === 'gemini-2.5-flash', 'model = gemini-2.5-flash (not gemini-3.8-pro or any invented id)');
  assert(resA.model !== 'gemini-3.8-pro', 'never falls back to the fake gemini-3.8-pro id');

  // ─── B. Settings persistence: save then re-read gives the same value ───
  console.log('\nB. Settings persistence');
  await prisma.organizationAiOperationSetting.update({
    where: { organizationId_operation: { organizationId: orgA.id, operation: 'TEXT_GENERATION' } },
    data: { model: 'gemini-2.0-flash' },
  });
  const reread = await prisma.organizationAiOperationSetting.findUnique({
    where: { organizationId_operation: { organizationId: orgA.id, operation: 'TEXT_GENERATION' } },
  });
  assert(reread?.model === 'gemini-2.0-flash', 'persisted model survives a re-read');

  // ─── C/D. Same provider, different operation resolve independently ───
  console.log('\nC/D. OpenAI text + OpenAI image resolve independently');
  await prisma.organizationAiCredential.create({
    data: { organizationId: orgA.id, provider: 'openai', encryptedApiKey: encryptSecret('sk-fake-key-org-a'), isActive: true },
  });
  await prisma.organizationAiOperationSetting.upsert({
    where: { organizationId_operation: { organizationId: orgA.id, operation: 'TEXT_GENERATION' } },
    update: { provider: 'openai', model: 'gpt-5' },
    create: { organizationId: orgA.id, operation: 'TEXT_GENERATION', provider: 'openai', model: 'gpt-5' },
  });
  await prisma.organizationAiOperationSetting.upsert({
    where: { organizationId_operation: { organizationId: orgA.id, operation: 'IMAGE_GENERATION' } },
    update: { provider: 'openai', model: 'gpt-image-1' },
    create: { organizationId: orgA.id, operation: 'IMAGE_GENERATION', provider: 'openai', model: 'gpt-image-1' },
  });
  const textRes = await resolveGeneration({ organizationId: orgA.id, operation: 'TEXT_GENERATION' });
  const imageRes = await resolveGeneration({ organizationId: orgA.id, operation: 'IMAGE_GENERATION' });
  assert(textRes.provider === 'openai' && textRes.model === 'gpt-5', 'TEXT op resolves openai/gpt-5');
  assert(imageRes.provider === 'openai' && imageRes.model === 'gpt-image-1', 'IMAGE op resolves openai/gpt-image-1 independently');

  // ─── E. Credential missing → semantic error, not a blank/silent failure ───
  console.log('\nE. Credential missing → AI_PROVIDER_NOT_CONFIGURED');
  await prisma.organizationAiOperationSetting.upsert({
    where: { organizationId_operation: { organizationId: orgA.id, operation: 'VIDEO_GENERATION' } },
    update: { provider: 'claude', model: 'whatever' },
    create: { organizationId: orgA.id, operation: 'VIDEO_GENERATION', provider: 'claude', model: 'whatever' },
  });
  await assertThrows(
    () => resolveGeneration({ organizationId: orgA.id, operation: 'VIDEO_GENERATION' }),
    'AI_MODEL_NOT_AVAILABLE',
    'claude has no VIDEO_GENERATION provider integration -> AI_MODEL_NOT_AVAILABLE',
  );
  // No operation setting at all for an org with zero config:
  const { org: orgEmpty } = await seedOrg('ai-settings-empty@example.com', 'AI Settings Empty Org');
  await assertThrows(
    () => resolveGeneration({ organizationId: orgEmpty.id, operation: 'TEXT_GENERATION' }),
    'AI_PROVIDER_NOT_CONFIGURED',
    'org with no operation setting and no credential -> AI_PROVIDER_NOT_CONFIGURED',
  );

  // ─── F. Credential decrypt error → safe semantic status, no secret exposed ───
  console.log('\nF. Credential decrypt error');
  await prisma.organizationAiCredential.create({
    data: { organizationId: orgEmpty.id, provider: 'gemini', encryptedApiKey: 'gcm1:not-valid-base64::corrupt', isActive: true },
  });
  const status = await credentialStatus({ organizationId: orgEmpty.id, provider: 'gemini' });
  assert(status === 'DECRYPT_ERROR', 'credentialStatus reports DECRYPT_ERROR for corrupt ciphertext');
  await assertThrows(
    () => resolveGeneration({ organizationId: orgEmpty.id, operation: 'TEXT_GENERATION', explicitProvider: 'gemini' }),
    'AI_CREDENTIAL_INVALID',
    'resolveGeneration surfaces AI_CREDENTIAL_INVALID rather than throwing a raw decrypt error',
  );

  // ─── G. Tenant isolation: org B never sees org A's key or settings ───
  console.log('\nG. Tenant isolation');
  await assertThrows(
    () => resolveGeneration({ organizationId: orgB.id, operation: 'TEXT_GENERATION' }),
    'AI_PROVIDER_NOT_CONFIGURED',
    'org B has no config of its own -> never inherits org A\'s gemini/openai settings',
  );
  const orgBCred = await prisma.organizationAiCredential.findUnique({
    where: { organizationId_provider: { organizationId: orgB.id, provider: 'gemini' } },
  });
  assert(orgBCred === null, 'org B has zero OrganizationAiCredential rows — nothing copied from org A');

  // Summary
  console.log(`\n${'='.repeat(40)}`);
  console.log(`${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
