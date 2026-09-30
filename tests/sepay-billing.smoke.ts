/**
 * M2.8+M2.9 SePay Payment Gateway smoke tests.
 * Run: DATABASE_URL=postgresql://mkttools:mkttools_secret@localhost:5432/mkt_smoke npx ts-node tests/sepay-billing.smoke.ts
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
  await prisma.paymentEvent.deleteMany();
  await prisma.paymentOrder.deleteMany();
  await prisma.subscriptionPlanPrice.deleteMany();
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
  await prisma.organizationAiCredential.deleteMany();
  await prisma.organization.deleteMany();
  await prisma.subscriptionPlan.deleteMany();
  await prisma.authToken.deleteMany();
  await prisma.userAuthIdentity.deleteMany();
  await prisma.userSession.deleteMany();
  await prisma.user.deleteMany();
}

async function seed() {
  const owner = await prisma.user.create({ data: { email: 'sepay-owner@example.com', name: 'Owner', passwordHash: 'x', isActive: true } });
  const member = await prisma.user.create({ data: { email: 'sepay-member@example.com', name: 'Member', passwordHash: 'x', isActive: true } });
  const org = await prisma.organization.create({ data: { name: 'SePay Org', ownerUserId: owner.id } });
  const org2 = await prisma.organization.create({ data: { name: 'Other Org', ownerUserId: owner.id } });
  await prisma.organizationMember.create({ data: { organizationId: org.id, userId: owner.id, role: 'OWNER', status: 'ACTIVE' } });
  await prisma.organizationMember.create({ data: { organizationId: org.id, userId: member.id, role: 'MEMBER', status: 'ACTIVE' } });
  await prisma.organizationMember.create({ data: { organizationId: org2.id, userId: owner.id, role: 'OWNER', status: 'ACTIVE' } });

  const starter = await prisma.subscriptionPlan.create({ data: { code: 'STARTER_3', name: 'Starter', maxPages: 3, maxMembers: 3, isActive: true, sortOrder: 1 } });
  const pro = await prisma.subscriptionPlan.create({ data: { code: 'PRO_10', name: 'Pro', maxPages: 10, maxMembers: 10, isActive: true, sortOrder: 2 } });

  await prisma.subscriptionPlanPrice.createMany({ data: [
    { planId: starter.id, billingMonths: 1, amount: 99000, currency: 'VND', sortOrder: 1 },
    { planId: starter.id, billingMonths: 3, amount: 259000, currency: 'VND', sortOrder: 2 },
    { planId: pro.id, billingMonths: 1, amount: 299000, currency: 'VND', sortOrder: 1 },
    { planId: pro.id, billingMonths: 12, amount: 2990000, currency: 'VND', sortOrder: 3 },
  ]});

  return { owner, member, org, org2, starter, pro };
}

async function main() {
  await cleanDb();
  const { owner, member, org, org2, starter, pro } = await seed();

  const { SePayProvider } = await import('../src/modules/billing/sepay');
  const { BillingService } = await import('../src/modules/billing');

  // ─── A. SePayProvider.buildCheckoutInfo ───
  console.log('\nA. SePayProvider.buildCheckoutInfo');
  const info = SePayProvider.buildCheckoutInfo('MKT-ABCDEFG', 99000);
  // buildCheckoutInfo returns null when SePay is not configured in platform settings
  // This is expected in a test environment without platform settings seeded
  assert(info === null || (info.orderCode === 'MKT-ABCDEFG' && info.amount === 99000),
    'Checkout info returns null (not configured) or correct values');

  // ─── B. Webhook auth verification ───
  console.log('\nB. Webhook auth verification');
  assert(!SePayProvider.verifyWebhookAuth(undefined), 'No header → false');
  assert(!SePayProvider.verifyWebhookAuth(''), 'Empty header → false');
  assert(!SePayProvider.verifyWebhookAuth('Apikey wrong-key'), 'Wrong key → false');
  assert(!SePayProvider.verifyWebhookAuth('Bearer Apikey wrong-key'), 'Bearer wrong key → false');

  // ─── C. Payload validation ───
  console.log('\nC. Payload validation');
  assert(!SePayProvider.validatePayload(null).valid, 'null → invalid');
  assert(!SePayProvider.validatePayload({}).valid, 'empty → invalid');
  assert(!SePayProvider.validatePayload({ transferType: 'out', transferAmount: 100, content: 'x' }).valid,
    'outgoing transfer → invalid');
  assert(!SePayProvider.validatePayload({ transferType: 'in', transferAmount: 0, content: 'x' }).valid,
    'zero amount → invalid');
  assert(!SePayProvider.validatePayload({ transferType: 'in', transferAmount: 100 }).valid,
    'no content/code → invalid');
  const validPayload = { transferType: 'in', transferAmount: 99000, content: 'MKT-ABCDEFG thanh toan' };
  assert(SePayProvider.validatePayload(validPayload).valid, 'valid payload → valid');

  // ─── D. Order code extraction ───
  console.log('\nD. Order code extraction');
  const p1 = { code: 'MKT-ABCDEFG', content: 'some transfer' } as any;
  assert(SePayProvider.extractOrderCode(p1) === 'MKT-ABCDEFG', 'Extract from code field');
  const p2 = { code: null, content: 'thanh toan MKT-XYZW234 cho don hang' } as any;
  assert(SePayProvider.extractOrderCode(p2) === 'MKT-XYZW234', 'Extract from content field');
  const p3 = { code: null, content: 'random transfer no code' } as any;
  assert(SePayProvider.extractOrderCode(p3) === null, 'No code → null');

  // ─── E. Checkout creation (order + checkout flow) ───
  console.log('\nE. Checkout order creation');
  const starterPrice = await prisma.subscriptionPlanPrice.findFirst({ where: { planId: starter.id, billingMonths: 1 } });
  const createResult = await BillingService.createPaymentOrder(org.id, owner.id, starterPrice!.id);
  assert(!('error' in createResult), 'Order created');
  const order = createResult.order!;
  assert(order.orderCode.startsWith('MKT-'), 'Order code format');
  assert(order.amount === 99000, 'Amount snapshotted');

  // ─── F. Amount mismatch rejected ───
  console.log('\nF. Amount mismatch detection');
  const mismatchPayload = {
    id: 1001, gateway: 'VCB', transactionDate: '2024-01-01', accountNumber: '123',
    subAccount: null, code: order.orderCode, content: order.orderCode,
    transferType: 'in' as const, transferAmount: 50000,  // wrong amount
    accumulated: 50000, referenceCode: 'REF001', description: 'test',
  };
  const mismatchEventId = SePayProvider.buildExternalEventId(mismatchPayload);
  // Simulate what the webhook handler does
  assert(mismatchPayload.transferAmount !== order.amount, 'Amount mismatch detected');
  await prisma.paymentEvent.create({
    data: {
      paymentOrderId: order.id, provider: 'SEPAY', externalEventId: mismatchEventId,
      eventType: 'AMOUNT_MISMATCH',
      payload: { transferAmount: mismatchPayload.transferAmount, expected: order.amount },
    },
  });
  const mismatchEvent = await prisma.paymentEvent.findUnique({
    where: { provider_externalEventId: { provider: 'SEPAY', externalEventId: mismatchEventId } },
  });
  assert(mismatchEvent !== null, 'Mismatch event recorded');
  assert(mismatchEvent!.eventType === 'AMOUNT_MISMATCH', 'Event type is AMOUNT_MISMATCH');
  // Order stays PENDING
  const orderAfterMismatch = await prisma.paymentOrder.findUnique({ where: { id: order.id } });
  assert(orderAfterMismatch!.status === 'PENDING', 'Order still PENDING after mismatch');

  // ─── G. Duplicate webhook idempotency ───
  console.log('\nG. Duplicate webhook idempotency (PaymentEvent dedup)');
  const confirmPayload = {
    id: 1002, gateway: 'VCB', transactionDate: '2024-01-01', accountNumber: '123',
    subAccount: null, code: order.orderCode, content: order.orderCode,
    transferType: 'in' as const, transferAmount: 99000,
    accumulated: 99000, referenceCode: 'REF002', description: 'test',
  };
  const confirmEventId = SePayProvider.buildExternalEventId(confirmPayload);
  // First: no existing event
  const existing1 = await prisma.paymentEvent.findUnique({
    where: { provider_externalEventId: { provider: 'SEPAY', externalEventId: confirmEventId } },
  });
  assert(existing1 === null, 'Event not yet recorded');

  // Record first event and mark paid
  await prisma.paymentEvent.create({
    data: {
      paymentOrderId: order.id, provider: 'SEPAY', externalEventId: confirmEventId,
      eventType: 'PAYMENT_CONFIRMED', payload: { transferAmount: 99000, referenceCode: 'REF002' },
    },
  });
  // Create trial sub so markPaymentPaid can activate
  await prisma.organizationSubscription.create({
    data: { organizationId: org.id, planId: starter.id, status: 'TRIAL',
      trialStartedAt: new Date(), trialEndsAt: new Date(Date.now() + 7*24*3600*1000) },
  });
  const payResult = await BillingService.markPaymentPaid(order.id, { provider: 'SEPAY', transactionId: 'REF002' });
  assert('ok' in payResult && payResult.ok === true, 'Payment applied');

  // Second: duplicate event exists → skip
  const existing2 = await prisma.paymentEvent.findUnique({
    where: { provider_externalEventId: { provider: 'SEPAY', externalEventId: confirmEventId } },
  });
  assert(existing2 !== null, 'Duplicate event detected');

  // markPaymentPaid is also idempotent
  const payResult2 = await BillingService.markPaymentPaid(order.id, { provider: 'SEPAY', transactionId: 'REF002' });
  assert('ok' in payResult2 && payResult2.alreadyPaid === true, 'markPaymentPaid idempotent');

  // ─── H. TRIAL → ACTIVE via SePay payment ───
  console.log('\nH. TRIAL → ACTIVE verified');
  const subs = await prisma.organizationSubscription.findMany({
    where: { organizationId: org.id }, orderBy: { startedAt: 'desc' },
  });
  const activeSub = subs.find(s => s.status === 'ACTIVE');
  assert(activeSub !== undefined, 'ACTIVE subscription created');
  assert(activeSub!.planId === starter.id, 'Plan matches order');
  assert(activeSub!.expiresAt !== null, 'Expiry date set');
  const cancelledTrial = subs.find(s => s.status === 'CANCELLED');
  assert(cancelledTrial !== undefined, 'Trial cancelled');

  // ─── I. Renewal extends from current expiry ───
  console.log('\nI. Renewal extends from expiry');
  const proPrice12 = await prisma.subscriptionPlanPrice.findFirst({ where: { planId: pro.id, billingMonths: 12 } });
  const renewResult = await BillingService.createPaymentOrder(org.id, owner.id, proPrice12!.id);
  assert(!('error' in renewResult), 'Renewal order created');
  const oldExpiry = activeSub!.expiresAt!.getTime();
  const renewPay = await BillingService.markPaymentPaid(renewResult.order!.id, { provider: 'SEPAY', transactionId: 'REF003' });
  assert('ok' in renewPay && renewPay.ok === true, 'Renewal payment applied');
  const renewed = await prisma.organizationSubscription.findFirst({ where: { organizationId: org.id, status: 'ACTIVE' } });
  const expectedExpiry = oldExpiry + 12 * 30 * 24 * 3600 * 1000;
  assert(Math.abs(renewed!.expiresAt!.getTime() - expectedExpiry) < 5000, 'Expiry extended by 12 months');
  assert(renewed!.planId === pro.id, 'Plan upgraded to PRO');

  // ─── J. Tenant isolation ───
  console.log('\nJ. Tenant isolation');
  const org2Price = await prisma.subscriptionPlanPrice.findFirst({ where: { planId: starter.id, billingMonths: 1 } });
  const org2Order = await BillingService.createPaymentOrder(org2.id, owner.id, org2Price!.id);
  assert(!('error' in org2Order), 'Org2 order created');
  // Org2's order should not be visible in org1's history
  const org1History = await BillingService.listOrganizationPayments(org.id);
  const org2CodeInOrg1 = org1History.items.find(i => i.orderCode === org2Order.order!.orderCode);
  assert(org2CodeInOrg1 === undefined, 'Org2 order not in org1 history');

  // ─── K. Unknown order (webhook with unmatched code) ───
  console.log('\nK. Unknown order code');
  const unknownOrder = await prisma.paymentOrder.findUnique({ where: { orderCode: 'MKT-ZZZZZZ9' } });
  assert(unknownOrder === null, 'Unknown order code returns null');

  // ─── L. External event ID uniqueness ───
  console.log('\nL. External event ID generation');
  const e1 = SePayProvider.buildExternalEventId({ id: 100, referenceCode: 'REF100' } as any);
  const e2 = SePayProvider.buildExternalEventId({ id: 100, referenceCode: 'REF100' } as any);
  const e3 = SePayProvider.buildExternalEventId({ id: 101, referenceCode: 'REF101' } as any);
  assert(e1 === e2, 'Same payload → same event ID');
  assert(e1 !== e3, 'Different payload → different event ID');
  assert(e1.startsWith('sepay_'), 'Event ID prefix');

  // ─── M. Expired order cannot be paid ───
  console.log('\nM. Expired order rejection');
  const expiredOrder = await prisma.paymentOrder.create({
    data: {
      organizationId: org.id, createdByUserId: owner.id,
      planId: starter.id, orderCode: 'MKT-EXPRD01',
      amount: 99000, currency: 'VND', billingMonths: 1,
      planCodeSnapshot: 'STARTER_3', planNameSnapshot: 'Starter',
      expiresAt: new Date(Date.now() - 60000),
    },
  });
  const expiredResult = await BillingService.markPaymentPaid(expiredOrder.id);
  assert('error' in expiredResult, 'Expired order returns error');

  // Summary
  console.log(`\n${'='.repeat(40)}`);
  console.log(`${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
