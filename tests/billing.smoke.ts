/**
 * M2.7 Billing Foundation smoke tests.
 * Run: DATABASE_URL=postgresql://mkttools:mkttools_secret@localhost:5432/mkt_smoke npx ts-node tests/billing.smoke.ts
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
  const user = await prisma.user.create({ data: { email: 'billing-test@example.com', name: 'Test', passwordHash: 'x', isActive: true } });
  const org = await prisma.organization.create({ data: { name: 'Billing Org', ownerUserId: user.id } });
  await prisma.organizationMember.create({ data: { organizationId: org.id, userId: user.id, role: 'OWNER', status: 'ACTIVE' } });

  const starter = await prisma.subscriptionPlan.create({ data: { code: 'STARTER_3', name: 'Starter', maxPages: 3, maxMembers: 3, isActive: true, sortOrder: 1 } });
  const pro = await prisma.subscriptionPlan.create({ data: { code: 'PRO_10', name: 'Pro', maxPages: 10, maxMembers: 10, isActive: true, sortOrder: 2 } });
  const enterprise = await prisma.subscriptionPlan.create({ data: { code: 'ENTERPRISE', name: 'Enterprise', maxPages: 100, maxMembers: 50, isActive: true, sortOrder: 3 } });

  // Prices
  await prisma.subscriptionPlanPrice.createMany({ data: [
    { planId: starter.id, billingMonths: 1, amount: 99000, currency: 'VND', sortOrder: 1 },
    { planId: starter.id, billingMonths: 3, amount: 259000, currency: 'VND', sortOrder: 2 },
    { planId: starter.id, billingMonths: 12, amount: 899000, currency: 'VND', sortOrder: 3 },
    { planId: pro.id, billingMonths: 1, amount: 299000, currency: 'VND', sortOrder: 1 },
    { planId: pro.id, billingMonths: 3, amount: 799000, currency: 'VND', sortOrder: 2 },
    { planId: pro.id, billingMonths: 12, amount: 2990000, currency: 'VND', sortOrder: 3 },
    // Enterprise: no prices (contact-only)
  ]});

  return { user, org, starter, pro, enterprise };
}

async function main() {
  await cleanDb();
  const { user, org, starter, pro, enterprise } = await seed();
  const { BillingService } = await import('../src/modules/billing');

  // ─── A. getPurchasablePlans ───
  console.log('\nA. getPurchasablePlans');
  const plans = await BillingService.getPurchasablePlans();
  assert(plans.length === 3, '3 plans returned');
  const starterPlan = plans.find(p => p.code === 'STARTER_3');
  assert(starterPlan!.prices.length === 3, 'Starter has 3 prices');
  const entPlan = plans.find(p => p.code === 'ENTERPRISE');
  assert(entPlan!.prices.length === 0, 'Enterprise has no prices (contact-only)');

  // ─── B. createPaymentOrder ───
  console.log('\nB. createPaymentOrder');
  const starterPrice1m = starterPlan!.prices.find(p => p.billingMonths === 1)!;
  const result1 = await BillingService.createPaymentOrder(org.id, user.id, starterPrice1m.id);
  assert(!('error' in result1), 'Order created without error');
  const order1 = result1.order!;
  assert(order1.orderCode.startsWith('MKT-'), 'Order code format MKT-XXXX');
  assert(order1.amount === 99000, 'Amount is 99000 VND');
  assert(order1.currency === 'VND', 'Currency is VND');
  assert(order1.billingMonths === 1, 'billingMonths = 1');
  assert(order1.planCodeSnapshot === 'STARTER_3', 'planCodeSnapshot correct');
  assert(order1.status === 'PENDING', 'Status is PENDING');
  assert(!order1.reused, 'Not reused');

  // ─── C. Duplicate pending order reuse ───
  console.log('\nC. Duplicate PENDING reuse');
  const result2 = await BillingService.createPaymentOrder(org.id, user.id, starterPrice1m.id);
  assert(!('error' in result2), 'No error on duplicate');
  assert(result2.order!.id === order1.id, 'Same order reused');
  assert(result2.order!.reused === true, 'Reused flag set');

  // ─── D. Price snapshot immutability ───
  console.log('\nD. Price snapshot immutability');
  await prisma.subscriptionPlanPrice.update({ where: { id: starterPrice1m.id }, data: { amount: 149000 } });
  const orderCheck = await BillingService.getPaymentOrder(order1.id);
  assert(orderCheck!.amount === 99000, 'Order amount stays 99000 after price change');
  // Restore price
  await prisma.subscriptionPlanPrice.update({ where: { id: starterPrice1m.id }, data: { amount: 99000 } });

  // ─── E. markPaymentPaid (TRIAL → ACTIVE) ───
  console.log('\nE. markPaymentPaid — TRIAL → ACTIVE');
  // First create a trial subscription
  await prisma.organizationSubscription.create({
    data: { organizationId: org.id, planId: starter.id, status: 'TRIAL',
      trialStartedAt: new Date(), trialEndsAt: new Date(Date.now() + 7*24*3600*1000) },
  });
  const payResult = await BillingService.markPaymentPaid(order1.id);
  assert(payResult.ok === true, 'markPaymentPaid succeeds');
  assert(payResult.alreadyPaid === false, 'Not already paid');
  const paidOrder = await prisma.paymentOrder.findUnique({ where: { id: order1.id } });
  assert(paidOrder!.status === 'PAID', 'Order status is PAID');
  assert(paidOrder!.paidAt !== null, 'paidAt is set');
  assert(paidOrder!.appliedAt !== null, 'appliedAt is set');

  // Verify subscription became ACTIVE
  const subs = await prisma.organizationSubscription.findMany({
    where: { organizationId: org.id }, orderBy: { startedAt: 'desc' },
  });
  const activeSub = subs.find(s => s.status === 'ACTIVE');
  assert(activeSub !== undefined, 'ACTIVE subscription exists');
  assert(activeSub!.expiresAt !== null, 'expiresAt is set');
  const trialSub = subs.find(s => s.status === 'CANCELLED');
  assert(trialSub !== undefined, 'Trial subscription is CANCELLED');

  // ─── F. Idempotent payment ───
  console.log('\nF. Idempotent payment');
  const payResult2 = await BillingService.markPaymentPaid(order1.id);
  assert(payResult2.ok === true, 'Idempotent call succeeds');
  assert(payResult2.alreadyPaid === true, 'alreadyPaid = true');
  const subsAfterIdempotent = await prisma.organizationSubscription.findMany({
    where: { organizationId: org.id, status: 'ACTIVE' },
  });
  assert(subsAfterIdempotent.length === 1, 'Still only 1 ACTIVE subscription');

  // ─── G. Renewal extends from current expiry ───
  console.log('\nG. Renewal extends from expiry');
  const proPrice3m = (await prisma.subscriptionPlanPrice.findFirst({
    where: { planId: pro.id, billingMonths: 3 },
  }))!;
  const renewalResult = await BillingService.createPaymentOrder(org.id, user.id, proPrice3m.id);
  assert(!('error' in renewalResult), 'Renewal order created');
  const renewalOrder = renewalResult.order!;

  const currentActive = await prisma.organizationSubscription.findFirst({
    where: { organizationId: org.id, status: 'ACTIVE' },
  });
  const oldExpiry = currentActive!.expiresAt!.getTime();

  const renewPay = await BillingService.markPaymentPaid(renewalOrder.id);
  assert(renewPay.ok === true, 'Renewal payment succeeds');

  const renewed = await prisma.organizationSubscription.findFirst({
    where: { organizationId: org.id, status: 'ACTIVE' },
  });
  const expectedExpiry = oldExpiry + 3 * 30 * 24 * 3600 * 1000;
  assert(Math.abs(renewed!.expiresAt!.getTime() - expectedExpiry) < 5000, 'Expiry extended by 3 months from old expiry');
  assert(renewed!.planId === pro.id, 'Plan changed to PRO');

  // ─── H. listOrganizationPayments ───
  console.log('\nH. listOrganizationPayments');
  const history = await BillingService.listOrganizationPayments(org.id);
  assert(history.items.length === 2, '2 orders in history');
  assert(history.items[0].orderCode === renewalOrder.orderCode, 'Most recent first');

  // ─── I. Order expiration ───
  console.log('\nI. Order expiration');
  const expiredOrder = await prisma.paymentOrder.create({
    data: {
      organizationId: org.id, createdByUserId: user.id,
      planId: starter.id, orderCode: 'MKT-EXPIRED1',
      amount: 99000, currency: 'VND', billingMonths: 1,
      planCodeSnapshot: 'STARTER_3', planNameSnapshot: 'Starter',
      expiresAt: new Date(Date.now() - 60000), // expired 1 minute ago
    },
  });
  const lazyExpired = await BillingService.getPaymentOrder(expiredOrder.id);
  assert(lazyExpired!.status === 'EXPIRED', 'Lazily expired');

  const payExpiredResult = await BillingService.markPaymentPaid(expiredOrder.id);
  assert(payExpiredResult.error === 'ORDER_NOT_PAYABLE', 'Cannot pay expired order');

  // ─── J. Cannot pay cancelled/failed order ───
  console.log('\nJ. Cannot pay non-PENDING');
  const cancelledOrder = await prisma.paymentOrder.create({
    data: {
      organizationId: org.id, createdByUserId: user.id,
      planId: starter.id, orderCode: 'MKT-CANCEL1',
      amount: 99000, currency: 'VND', billingMonths: 1,
      planCodeSnapshot: 'STARTER_3', planNameSnapshot: 'Starter',
      expiresAt: new Date(Date.now() + 3600000), status: 'CANCELLED',
    },
  });
  const payCancelled = await BillingService.markPaymentPaid(cancelledOrder.id);
  assert(payCancelled.error === 'ORDER_NOT_PAYABLE', 'Cannot pay cancelled order');

  // ─── K. Enterprise plan has no purchasable prices ───
  console.log('\nK. Enterprise contact-only');
  const entPrices = await prisma.subscriptionPlanPrice.findMany({ where: { planId: enterprise.id, isActive: true } });
  assert(entPrices.length === 0, 'Enterprise has no active prices');

  // Summary
  console.log(`\n${'='.repeat(40)}`);
  console.log(`${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
