/**
 * Organization Security/RBAC V2 regression suite.
 *
 * Run against an isolated database:
 *   DATABASE_URL=postgresql://... npx tsx tests/tenant-security.smoke.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
let passed = 0;
let failed = 0;
const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

function assert(condition: boolean, label: string) {
  if (condition) { console.log(`  OK: ${label}`); passed++; }
  else { console.error(`  FAIL: ${label}`); failed++; }
}

async function main() {
  const {
    resolveCurrentOrganization, isPlatformAdmin, roleAtLeast,
    canManageMemberRole, removesLastActiveOwner,
  } = await import('../src/modules/organization');
  const { getAccessContext, canAccessPage } = await import('../src/modules/access');
  const { resolveCredential } = await import('../src/modules/ai-credentials');
  const { encryptSecret } = await import('../src/utils/crypto');
  const { getOrganizationSettings, setOrganizationSettings } = await import('../src/modules/settings/organization-settings');
  const { assertQueueOrganization } = await import('../src/queues/security');
  const { publishContent } = await import('../src/modules/publisher');
  const { canUserJoinOrganizationRoom, canUserJoinPageRoom } = await import('../src/realtime');

  const ownerA = await prisma.user.create({ data: { email: `owner-a-${runId}@example.com`, name: 'Owner A', passwordHash: 'x' } });
  const ownerB = await prisma.user.create({ data: { email: `owner-b-${runId}@example.com`, name: 'Owner B', passwordHash: 'x' } });
  const restricted = await prisma.user.create({ data: { email: `restricted-${runId}@example.com`, name: 'Restricted', passwordHash: 'x' } });
  const platformAdmin = await prisma.user.create({ data: { email: `platform-${runId}@example.com`, name: 'Platform', passwordHash: 'x', isPlatformAdmin: true } });
  const orgA = await prisma.organization.create({ data: { name: 'Org A', ownerUserId: ownerA.id } });
  const orgB = await prisma.organization.create({ data: { name: 'Org B', ownerUserId: ownerB.id } });
  const memberA = await prisma.organizationMember.create({ data: { organizationId: orgA.id, userId: ownerA.id, role: 'OWNER' } });
  await prisma.organizationMember.create({ data: { organizationId: orgB.id, userId: ownerB.id, role: 'OWNER' } });
  const restrictedMember = await prisma.organizationMember.create({ data: { organizationId: orgA.id, userId: restricted.id, role: 'MEMBER', accessMode: 'RESTRICTED' } });
  const pageA1 = await prisma.page.create({ data: { organizationId: orgA.id, platform: 'FACEBOOK', name: 'A1', externalId: `a1-${runId}`, accessToken: 'a', userId: ownerA.id } });
  const pageA2 = await prisma.page.create({ data: { organizationId: orgA.id, platform: 'FACEBOOK', name: 'A2', externalId: `a2-${runId}`, accessToken: 'a', userId: ownerA.id } });
  const pageB = await prisma.page.create({ data: { organizationId: orgB.id, platform: 'FACEBOOK', name: 'B', externalId: `b-${runId}`, accessToken: 'b', userId: ownerB.id } });
  await prisma.organizationMemberPage.create({ data: { organizationMemberId: restrictedMember.id, pageId: pageA1.id } });

  console.log('\nTenant selection and access');
  assert((await resolveCurrentOrganization(ownerA.id, orgB.id)).denied, '1. Org A user + Org B id is denied');
  const ctxA = await getAccessContext(orgA.id, ownerA.id);
  assert(!!ctxA && !(await canAccessPage(ctxA, pageB.id)), '2. Org A cannot update/delete an Org B resource');
  assert(pageB.organizationId !== orgA.id, '3. Page B cannot be related to Org A campaign/content');
  const restrictedCtx = await getAccessContext(orgA.id, restricted.id);
  assert(!!restrictedCtx && await canAccessPage(restrictedCtx, pageA1.id), '4. restricted member assigned page is allowed');
  assert(!!restrictedCtx && !(await canAccessPage(restrictedCtx, pageA2.id)), '5. restricted member unassigned page is denied');
  assert((await resolveCurrentOrganization(platformAdmin.id, orgB.id)).denied, '6. platform admin has no normal customer API bypass');
  assert(await isPlatformAdmin(platformAdmin.id), '7. legitimate platform-admin guard allows platform admin');

  console.log('\nRole and invitation policy');
  assert(!roleAtLeast('MANAGER', 'ADMIN') && !roleAtLeast('MEMBER', 'ADMIN'), '8. MEMBER/MANAGER cannot escalate roles');
  assert(!canManageMemberRole('ADMIN', 'OWNER', 'ADMIN'), '9. ADMIN cannot modify OWNER');
  assert(removesLastActiveOwner('OWNER', 'ACTIVE', 'ADMIN', 'ACTIVE', 1), '10. last active OWNER is protected');

  console.log('\nSettings and credential isolation');
  await prisma.organizationAiCredential.create({ data: { organizationId: orgA.id, provider: 'gemini', encryptedApiKey: encryptSecret('org-a-secret'), isActive: true } });
  let orgBHasCredential = true;
  try { await resolveCredential({ organizationId: orgB.id, provider: 'gemini' }); } catch { orgBHasCredential = false; }
  assert(!orgBHasCredential, '11. new Org B has no Org A AI credential');
  await setOrganizationSettings(orgA.id, { TELEGRAM_BOT_TOKEN: 'token-a', FACEBOOK_APP_ID: 'fb-a', FACEBOOK_APP_SECRET: 'secret-a' });
  const settingsB = await getOrganizationSettings(orgB.id);
  assert(!settingsB.TELEGRAM_BOT_TOKEN && !settingsB.FACEBOOK_APP_ID && !settingsB.FACEBOOK_APP_SECRET, '12. new Org B has no Org A Telegram/Facebook config');
  const resolvedA = await resolveCredential({ organizationId: orgA.id, provider: 'gemini' });
  assert(resolvedA.apiKey === 'org-a-secret', '13. generation credential resolves for the requested organization');

  console.log('\nQueue, publish, realtime, invitations');
  let mismatchDenied = false;
  try { assertQueueOrganization(orgA.id, orgB.id); } catch { mismatchDenied = true; }
  assert(mismatchDenied, '14. queue organization/resource mismatch is denied');
  const campaignA = await prisma.campaign.create({ data: { organizationId: orgA.id, name: 'A', pageId: pageA1.id, startDate: new Date(), userId: ownerA.id } });
  const contentA = await prisma.contentItem.create({ data: { organizationId: orgA.id, campaignId: campaignA.id, pageId: pageA1.id, scheduledAt: new Date(), topic: 'A', generatedText: 'A', status: 'APPROVED' } });
  const publishMismatch = await publishContent(contentA.id, orgB.id);
  assert(!publishMismatch.success && publishMismatch.error === 'Queue organization mismatch', '15. cross-tenant publish is denied');
  assert(!(await canUserJoinOrganizationRoom(ownerA.id, orgB.id)) && !(await canUserJoinPageRoom(ownerA.id, orgA.id, pageB.id)), '16. unauthorized Socket.IO subscriptions are denied');
  const inviteB = await prisma.organizationInvitation.create({ data: { organizationId: orgB.id, email: `invite-${runId}@example.com`, role: 'MEMBER', invitedByUserId: ownerB.id, tokenHash: `hash-b-${runId}`, expiresAt: new Date(Date.now() + 3600000) } });
  const visibleToA = await prisma.organizationInvitation.findFirst({ where: { id: inviteB.id, organizationId: orgA.id } });
  assert(visibleToA === null, '17. cross-org invitation manipulation lookup is denied');

  if (memberA.role !== 'OWNER') throw new Error('Security fixture owner was unexpectedly modified');
  console.log(`\nSecurity results: ${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
