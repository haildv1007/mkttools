import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { prisma } from '../../utils/db';
import { AuthRequest } from '../../middleware/auth';
import { roleAtLeast, OrgRole, pickCurrentSubscription, resolveSubscriptionContext, OrganizationQuota } from '../organization';
import { getPlatformSettingBool, getOrderTtlMs, getSePayConfig } from '../platform-settings';
import { SePayProvider } from './sepay';
import { logger } from '../../utils/logger';
import { getIO } from '../../realtime';

const ORDER_TTL_MS = 30 * 60 * 1000; // 30 minutes - default, overridden by platform setting
const DAY_MS = 24 * 3600 * 1000;

// ─── Order code generation ───

function generateOrderCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  const bytes = crypto.randomBytes(7);
  for (let i = 0; i < 7; i++) code += chars[bytes[i] % chars.length];
  return `MKT-${code}`;
}

// ─── BillingService ───

export const BillingService = {
  async getPurchasablePlans() {
    const plans = await prisma.subscriptionPlan.findMany({
      where: { isActive: true },
      include: {
        prices: {
          where: { isActive: true },
          orderBy: { sortOrder: 'asc' },
        },
      },
      orderBy: { sortOrder: 'asc' },
    });
    return plans.map((p) => ({
      id: p.id,
      code: p.code,
      name: p.name,
      maxPages: p.maxPages,
      maxMembers: p.maxMembers,
      prices: p.prices.map((pr) => ({
        id: pr.id,
        billingMonths: pr.billingMonths,
        amount: pr.amount,
        currency: pr.currency,
      })),
    }));
  },

  async createPaymentOrder(organizationId: string, userId: string, planPriceId: string) {
    const price = await prisma.subscriptionPlanPrice.findUnique({
      where: { id: planPriceId },
      include: { plan: true },
    });
    if (!price || !price.isActive || !price.plan.isActive) {
      return { error: 'PRICE_NOT_FOUND', message: 'Gói giá không tồn tại hoặc không khả dụng.' };
    }

    // Reuse existing valid PENDING order for same org+plan+period
    const now = new Date();
    const existing = await prisma.paymentOrder.findFirst({
      where: {
        organizationId,
        planId: price.planId,
        billingMonths: price.billingMonths,
        status: 'PENDING',
        expiresAt: { gt: now },
      },
    });
    if (existing) {
      return {
        order: {
          id: existing.id,
          orderCode: existing.orderCode,
          amount: existing.amount,
          currency: existing.currency,
          billingMonths: existing.billingMonths,
          planCodeSnapshot: existing.planCodeSnapshot,
          planNameSnapshot: existing.planNameSnapshot,
          status: existing.status,
          expiresAt: existing.expiresAt,
          createdAt: existing.createdAt,
          reused: true,
        },
      };
    }

    const orderCode = generateOrderCode();
    const ttl = getOrderTtlMs() || ORDER_TTL_MS;
    const expiresAt = new Date(now.getTime() + ttl);

    const order = await prisma.paymentOrder.create({
      data: {
        organizationId,
        createdByUserId: userId,
        planId: price.planId,
        planPriceId: price.id,
        orderCode,
        amount: price.amount,
        currency: price.currency,
        billingMonths: price.billingMonths,
        planCodeSnapshot: price.plan.code,
        planNameSnapshot: price.plan.name,
        expiresAt,
      },
    });

    return {
      order: {
        id: order.id,
        orderCode: order.orderCode,
        amount: order.amount,
        currency: order.currency,
        billingMonths: order.billingMonths,
        planCodeSnapshot: order.planCodeSnapshot,
        planNameSnapshot: order.planNameSnapshot,
        status: order.status,
        expiresAt: order.expiresAt,
        createdAt: order.createdAt,
        reused: false,
      },
    };
  },

  async getPaymentOrder(orderId: string, organizationId?: string) {
    const order = organizationId
      ? await prisma.paymentOrder.findFirst({ where: { id: orderId, organizationId } })
      : await prisma.paymentOrder.findUnique({ where: { id: orderId } });
    if (!order) return null;
    // Lazy expiration
    if (order.status === 'PENDING' && order.expiresAt <= new Date()) {
      await prisma.paymentOrder.update({ where: { id: orderId }, data: { status: 'EXPIRED' } }).catch(() => {});
      return { ...order, status: 'EXPIRED' as const };
    }
    return order;
  },

  async listOrganizationPayments(organizationId: string, page = 1, pageSize = 25) {
    const where = { organizationId };
    const [total, items] = await Promise.all([
      prisma.paymentOrder.count({ where }),
      prisma.paymentOrder.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true, orderCode: true, amount: true, currency: true,
          billingMonths: true, planCodeSnapshot: true, planNameSnapshot: true,
          status: true, provider: true, expiresAt: true, paidAt: true,
          appliedAt: true, createdAt: true,
        },
      }),
    ]);
    // Lazy-expire PENDING orders in the returned list
    const now = new Date();
    const result = items.map((o) => {
      if (o.status === 'PENDING' && o.expiresAt <= now) {
        prisma.paymentOrder.update({ where: { id: o.id }, data: { status: 'EXPIRED' } }).catch(() => {});
        return { ...o, status: 'EXPIRED' as const };
      }
      return o;
    });
    return { total, page, pageSize, items: result };
  },

  /**
   * Mark a payment order as PAID and apply subscription changes.
   * Transactional + idempotent. Called by trusted provider handler (M2.8).
   */
  async markPaymentPaid(orderId: string, providerInfo?: { provider: string; transactionId: string }) {
    return prisma.$transaction(async (tx) => {
      // Lock the order row with FOR UPDATE via raw query
      const rows = await tx.$queryRawUnsafe<any[]>(
        `SELECT * FROM payment_orders WHERE id = $1 FOR UPDATE`, orderId
      );
      const order = rows[0];
      if (!order) return { error: 'ORDER_NOT_FOUND' };

      // Idempotent: already paid
      if (order.status === 'PAID') {
        return { ok: true, alreadyPaid: true, orderId: order.id };
      }

      // Can only pay PENDING orders
      if (order.status !== 'PENDING') {
        return { error: 'ORDER_NOT_PAYABLE', message: `Order status is ${order.status}` };
      }

      // Check expiration
      if (order.expires_at <= new Date()) {
        await tx.paymentOrder.update({ where: { id: orderId }, data: { status: 'EXPIRED' } });
        return { error: 'ORDER_EXPIRED' };
      }

      const now = new Date();

      // Mark PAID
      await tx.paymentOrder.update({
        where: { id: orderId },
        data: {
          status: 'PAID',
          paidAt: now,
          provider: providerInfo?.provider ?? order.provider,
          providerTransactionId: providerInfo?.transactionId ?? order.provider_transaction_id,
        },
      });

      // Apply subscription
      await BillingService._applyPaidOrder(tx, order, now);

      // Mark applied
      await tx.paymentOrder.update({
        where: { id: orderId },
        data: { appliedAt: now },
      });

      return { ok: true, alreadyPaid: false, orderId: order.id };
    });
  },

  /** Internal: apply a paid order's subscription changes within a transaction. */
  async _applyPaidOrder(tx: any, order: any, now: Date) {
    const orgId = order.organization_id;
    const planId = order.plan_id;
    const billingMonths = order.billing_months;

    const subs = await tx.organizationSubscription.findMany({
      where: { organizationId: orgId },
      include: { plan: true },
    });
    const current = pickCurrentSubscription(subs);

    const addMs = billingMonths * 30 * DAY_MS;

    if (current && (current.status === 'ACTIVE') && current.expiresAt && current.expiresAt > now) {
      // Renewal or plan change: extend from current expiry
      const newExpiry = new Date(current.expiresAt.getTime() + addMs);
      await tx.organizationSubscription.update({
        where: { id: current.id },
        data: {
          planId,
          status: 'ACTIVE',
          expiresAt: newExpiry,
          // Preserve custom limits (Platform Admin overrides survive customer purchase)
        },
      });
    } else {
      // TRIAL / EXPIRED / CANCELLED / no subscription: cancel old, create new ACTIVE
      if (current && (current.status === 'ACTIVE' || current.status === 'TRIAL')) {
        await tx.organizationSubscription.update({
          where: { id: current.id },
          data: { status: 'CANCELLED' },
        });
      }
      const newExpiry = new Date(now.getTime() + addMs);
      await tx.organizationSubscription.create({
        data: {
          organizationId: orgId,
          planId,
          status: 'ACTIVE',
          startedAt: now,
          expiresAt: newExpiry,
          // Custom limits are NOT copied: fresh subscription from customer purchase.
          // Platform Admin can re-add overrides if needed.
        },
      });
    }
  },

  async expireOrder(orderId: string) {
    return prisma.paymentOrder.update({
      where: { id: orderId },
      data: { status: 'EXPIRED' },
    });
  },
};

// ─── Routes ───

// Public pricing API (no auth required)
const publicRouter = Router();

publicRouter.get('/plans', async (_req, res: Response) => {
  const plans = await BillingService.getPurchasablePlans();
  res.json(plans);
});

// Customer billing API (requires auth + org)
const customerRouter = Router();

function requireBillingRole(req: AuthRequest, res: Response): boolean {
  if (!roleAtLeast(req.organizationRole, 'ADMIN')) {
    res.status(403).json({ error: 'FORBIDDEN', message: 'Chỉ Owner/Admin được thực hiện thanh toán.' });
    return false;
  }
  return true;
}

customerRouter.post('/orders', async (req: AuthRequest, res: Response) => {
  if (!requireBillingRole(req, res)) return;
  const { planPriceId } = req.body || {};
  if (!planPriceId) return res.status(400).json({ error: 'MISSING_PRICE', message: 'Vui lòng chọn gói và kỳ hạn.' });

  const result = await BillingService.createPaymentOrder(req.organizationId!, req.userId!, String(planPriceId));
  if ('error' in result) return res.status(400).json(result);
  res.json(result.order);
});

customerRouter.get('/orders', async (req: AuthRequest, res: Response) => {
  if (!req.organizationId) return res.status(403).json({ error: 'NO_ORGANIZATION' });
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = [10, 25, 50].includes(Number(req.query.pageSize)) ? Number(req.query.pageSize) : 25;
  const result = await BillingService.listOrganizationPayments(req.organizationId, page, pageSize);
  res.json(result);
});

customerRouter.get('/orders/:id', async (req: AuthRequest, res: Response) => {
  if (!req.organizationId) return res.status(403).json({ error: 'NO_ORGANIZATION' });
  const order = await BillingService.getPaymentOrder(String(req.params.id), req.organizationId);
  if (!order) {
    return res.status(404).json({ error: 'NOT_FOUND' });
  }
  res.json({
    id: order.id, orderCode: order.orderCode, amount: order.amount, currency: order.currency,
    billingMonths: order.billingMonths, planCodeSnapshot: order.planCodeSnapshot,
    planNameSnapshot: order.planNameSnapshot, status: order.status, provider: order.provider,
    expiresAt: order.expiresAt, paidAt: order.paidAt, appliedAt: order.appliedAt, createdAt: order.createdAt,
  });
});

// Admin billing API
const adminRouter = Router();

adminRouter.get('/prices', async (_req: AuthRequest, res: Response) => {
  const plans = await prisma.subscriptionPlan.findMany({
    include: { prices: { orderBy: { billingMonths: 'asc' } } },
    orderBy: { sortOrder: 'asc' },
  });
  res.json(plans.map((p) => ({
    id: p.id, code: p.code, name: p.name, maxPages: p.maxPages, maxMembers: p.maxMembers,
    isActive: p.isActive, sortOrder: p.sortOrder,
    prices: p.prices.map((pr) => ({
      id: pr.id, billingMonths: pr.billingMonths, amount: pr.amount,
      currency: pr.currency, isActive: pr.isActive, sortOrder: pr.sortOrder,
    })),
  })));
});

adminRouter.put('/prices/:planId', async (req: AuthRequest, res: Response) => {
  const planId = String(req.params.planId);
  const plan = await prisma.subscriptionPlan.findUnique({ where: { id: planId } });
  if (!plan) return res.status(404).json({ error: 'PLAN_NOT_FOUND' });

  const prices: Array<{ billingMonths: number; amount: number | null; isActive?: boolean }> = req.body?.prices;
  if (!Array.isArray(prices)) return res.status(400).json({ error: 'INVALID_INPUT' });

  for (const p of prices) {
    if (!Number.isInteger(p.billingMonths) || p.billingMonths < 1) {
      return res.status(400).json({ error: 'INVALID_BILLING_MONTHS' });
    }
    if (p.amount != null && (!Number.isInteger(p.amount) || p.amount < 0)) {
      return res.status(400).json({ error: 'INVALID_AMOUNT' });
    }
  }

  await prisma.$transaction(async (tx) => {
    for (const p of prices) {
      if (p.amount == null) {
        // Remove price if amount is null
        await tx.subscriptionPlanPrice.deleteMany({
          where: { planId, billingMonths: p.billingMonths },
        });
        continue;
      }
      await tx.subscriptionPlanPrice.upsert({
        where: { planId_billingMonths: { planId, billingMonths: p.billingMonths } },
        update: { amount: p.amount, isActive: p.isActive ?? true },
        create: {
          planId, billingMonths: p.billingMonths,
          amount: p.amount, isActive: p.isActive ?? true,
          sortOrder: p.billingMonths,
        },
      });
    }
  });

  const updated = await prisma.subscriptionPlanPrice.findMany({
    where: { planId },
    orderBy: { billingMonths: 'asc' },
  });
  res.json(updated);
});

adminRouter.get('/payments', async (req: AuthRequest, res: Response) => {
  const q = req.query as Record<string, string>;
  const pageSize = [25, 50, 100].includes(Number(q.pageSize)) ? Number(q.pageSize) : 25;
  const page = Math.max(1, Number(q.page) || 1);

  const where: any = {};
  if (q.status) where.status = q.status;
  if (q.planCode) where.planCodeSnapshot = q.planCode;

  const term = (q.q || '').trim();
  if (term) {
    where.OR = [
      { orderCode: { contains: term, mode: 'insensitive' } },
      { organization: { name: { contains: term, mode: 'insensitive' } } },
    ];
  }

  const [total, items] = await Promise.all([
    prisma.paymentOrder.count({ where }),
    prisma.paymentOrder.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        organization: { select: { id: true, name: true } },
        createdByUser: { select: { id: true, name: true, email: true } },
      },
    }),
  ]);

  res.json({
    total, page, pageSize,
    items: items.map((o) => ({
      id: o.id, orderCode: o.orderCode, amount: o.amount, currency: o.currency,
      billingMonths: o.billingMonths, planCodeSnapshot: o.planCodeSnapshot,
      planNameSnapshot: o.planNameSnapshot, status: o.status, provider: o.provider,
      providerTransactionId: o.providerTransactionId,
      organizationId: o.organization.id, organizationName: o.organization.name,
      createdByName: o.createdByUser.name, createdByEmail: o.createdByUser.email,
      expiresAt: o.expiresAt, paidAt: o.paidAt, appliedAt: o.appliedAt, createdAt: o.createdAt,
    })),
  });
});

adminRouter.get('/payments/:id', async (req: AuthRequest, res: Response) => {
  const order = await prisma.paymentOrder.findUnique({
    where: { id: String(req.params.id) },
    include: {
      organization: { select: { id: true, name: true } },
      createdByUser: { select: { id: true, name: true, email: true } },
      events: { orderBy: { createdAt: 'asc' } },
    },
  });
  if (!order) return res.status(404).json({ error: 'NOT_FOUND' });
  res.json({
    id: order.id, orderCode: order.orderCode, amount: order.amount, currency: order.currency,
    billingMonths: order.billingMonths, planCodeSnapshot: order.planCodeSnapshot,
    planNameSnapshot: order.planNameSnapshot, status: order.status,
    provider: order.provider, providerOrderId: order.providerOrderId,
    providerTransactionId: order.providerTransactionId,
    organizationId: order.organization.id, organizationName: order.organization.name,
    createdByName: order.createdByUser.name, createdByEmail: order.createdByUser.email,
    expiresAt: order.expiresAt, paidAt: order.paidAt, appliedAt: order.appliedAt, createdAt: order.createdAt,
    events: order.events.map((e) => ({
      id: e.id, provider: e.provider, externalEventId: e.externalEventId,
      eventType: e.eventType, createdAt: e.createdAt,
    })),
  });
});

// ─── Checkout endpoint ───

customerRouter.post('/orders/:id/checkout', async (req: AuthRequest, res: Response) => {
  if (!requireBillingRole(req, res)) return;
  if (!getPlatformSettingBool('payment.enabled')) {
    return res.status(503).json({ error: 'PAYMENTS_DISABLED', message: 'Thanh toán trực tuyến đang tạm thời chưa khả dụng.' });
  }
  const order = await BillingService.getPaymentOrder(String(req.params.id), req.organizationId);
  if (!order) {
    return res.status(404).json({ error: 'NOT_FOUND' });
  }
  if (order.status !== 'PENDING') {
    return res.status(400).json({ error: 'ORDER_NOT_PAYABLE', message: `Đơn hàng ở trạng thái ${order.status}.` });
  }
  const checkout = SePayProvider.buildCheckoutInfo(order.orderCode, order.amount);
  if (!checkout) {
    return res.status(503).json({ error: 'PAYMENT_NOT_CONFIGURED', message: 'Cấu hình thanh toán chưa hoàn tất.' });
  }
  // Bind provider to order if not already
  if (!order.provider) {
    await prisma.paymentOrder.update({ where: { id: order.id }, data: { provider: 'SEPAY' } });
  }
  res.json({
    orderCode: order.orderCode,
    amount: order.amount,
    currency: order.currency,
    planNameSnapshot: order.planNameSnapshot,
    billingMonths: order.billingMonths,
    expiresAt: order.expiresAt,
    checkout,
  });
});

// ─── Customer billing context ───

customerRouter.get('/context', async (req: AuthRequest, res: Response) => {
  if (!req.organizationId) return res.status(403).json({ error: 'NO_ORGANIZATION' });
  const [subCtx, pageUsed, memberUsed] = await Promise.all([
    resolveSubscriptionContext(req.organizationId),
    OrganizationQuota.getPageUsage(req.organizationId),
    OrganizationQuota.getMemberUsage(req.organizationId),
  ]);
  res.json({
    subscription: subCtx,
    pageUsage: { used: pageUsed, limit: subCtx.pageLimit },
    memberUsage: { used: memberUsed, limit: subCtx.memberLimit },
    paymentEnabled: getPlatformSettingBool('payment.enabled'),
    canCheckout: roleAtLeast(req.organizationRole, 'ADMIN'),
  });
});

// Lookup by orderCode (for customer billing page status polling)
customerRouter.get('/orders/code/:code', async (req: AuthRequest, res: Response) => {
  if (!req.organizationId) return res.status(403).json({ error: 'NO_ORGANIZATION' });
  const order = await prisma.paymentOrder.findUnique({ where: { orderCode: String(req.params.code) } });
  if (!order || order.organizationId !== req.organizationId) {
    return res.status(404).json({ error: 'NOT_FOUND' });
  }
  // Lazy expiration
  if (order.status === 'PENDING' && order.expiresAt <= new Date()) {
    await prisma.paymentOrder.update({ where: { id: order.id }, data: { status: 'EXPIRED' } }).catch(() => {});
    return res.json({ ...safeOrderResponse(order), status: 'EXPIRED' });
  }
  res.json(safeOrderResponse(order));
});

function safeOrderResponse(order: any) {
  return {
    id: order.id, orderCode: order.orderCode, amount: order.amount, currency: order.currency,
    billingMonths: order.billingMonths, planCodeSnapshot: order.planCodeSnapshot,
    planNameSnapshot: order.planNameSnapshot, status: order.status, provider: order.provider,
    expiresAt: order.expiresAt, paidAt: order.paidAt, appliedAt: order.appliedAt, createdAt: order.createdAt,
  };
}

// ─── SePay Webhook ───

const webhookRouter = Router();

webhookRouter.post('/sepay/webhook', async (req: Request, res: Response) => {
  if (!SePayProvider.verifyWebhookAuth(req.headers.authorization)) {
    logger.warn({ ip: req.ip }, 'SEPAY_WEBHOOK_AUTH_FAILED');
    return res.status(403).json({ success: false });
  }

  const { valid, payload, error } = SePayProvider.validatePayload(req.body);
  if (!valid || !payload) {
    logger.warn({ error }, 'SEPAY_WEBHOOK_INVALID_PAYLOAD');
    return res.json({ success: true }); // ACK to prevent retries
  }

  const orderCode = SePayProvider.extractOrderCode(payload);
  if (!orderCode) {
    logger.info({ content: payload.content?.substring(0, 100) }, 'SEPAY_WEBHOOK_NO_ORDER_CODE');
    return res.json({ success: true });
  }

  const order = await prisma.paymentOrder.findUnique({ where: { orderCode } });
  if (!order) {
    logger.warn({ orderCode }, 'SEPAY_WEBHOOK_UNKNOWN_ORDER');
    return res.json({ success: true });
  }

  // Idempotency: check if this event was already processed
  const externalEventId = SePayProvider.buildExternalEventId(payload);
  const existingEvent = await prisma.paymentEvent.findUnique({
    where: { provider_externalEventId: { provider: 'SEPAY', externalEventId } },
  });
  if (existingEvent) {
    logger.info({ orderCode, externalEventId }, 'SEPAY_WEBHOOK_DUPLICATE');
    return res.json({ success: true });
  }

  // Amount verification - critical security check
  if (payload.transferAmount !== order.amount) {
    logger.error({
      orderCode,
      expected: order.amount,
      received: payload.transferAmount,
    }, 'SEPAY_WEBHOOK_AMOUNT_MISMATCH');
    await prisma.paymentEvent.create({
      data: {
        paymentOrderId: order.id,
        provider: 'SEPAY',
        externalEventId,
        eventType: 'AMOUNT_MISMATCH',
        payload: { transferAmount: payload.transferAmount, expected: order.amount, referenceCode: payload.referenceCode },
      },
    });
    return res.json({ success: true });
  }

  // Record the payment event
  await prisma.paymentEvent.create({
    data: {
      paymentOrderId: order.id,
      provider: 'SEPAY',
      externalEventId,
      eventType: 'PAYMENT_CONFIRMED',
      payload: {
        gateway: payload.gateway,
        transactionDate: payload.transactionDate,
        referenceCode: payload.referenceCode,
        accountNumber: payload.accountNumber,
        transferAmount: payload.transferAmount,
      },
    },
  });

  // Mark paid via BillingService (idempotent, transactional)
  const result = await BillingService.markPaymentPaid(order.id, {
    provider: 'SEPAY',
    transactionId: payload.referenceCode || String(payload.id),
  });

  if (result && 'ok' in result && result.ok) {
    logger.info({ orderCode, alreadyPaid: result.alreadyPaid }, 'SEPAY_PAYMENT_APPLIED');
    // Emit realtime event for billing UI
    const io = getIO();
    if (io && order.organizationId) {
      io.to(`org:${order.organizationId}`).emit('payment:updated', {
        orderCode: order.orderCode,
        status: 'PAID',
      });
    }
  } else {
    logger.warn({ orderCode, result }, 'SEPAY_PAYMENT_APPLY_FAILED');
  }

  res.json({ success: true });
});

export {
  publicRouter as billingPublicRouter,
  customerRouter as billingCustomerRouter,
  adminRouter as billingAdminRouter,
  webhookRouter as billingWebhookRouter,
};
