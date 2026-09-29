-- M2.7 billing foundation + pricing V1

-- Payment order status enum
CREATE TYPE "PaymentOrderStatus" AS ENUM ('PENDING', 'PAID', 'EXPIRED', 'CANCELLED', 'FAILED');

-- Subscription plan prices
CREATE TABLE "subscription_plan_prices" (
  "id" TEXT NOT NULL,
  "plan_id" TEXT NOT NULL,
  "billing_months" INTEGER NOT NULL,
  "amount" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'VND',
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "subscription_plan_prices_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "subscription_plan_prices_plan_id_billing_months_key" ON "subscription_plan_prices"("plan_id", "billing_months");

ALTER TABLE "subscription_plan_prices"
  ADD CONSTRAINT "subscription_plan_prices_plan_id_fkey"
  FOREIGN KEY ("plan_id") REFERENCES "subscription_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Payment orders
CREATE TABLE "payment_orders" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "created_by_user_id" TEXT NOT NULL,
  "plan_id" TEXT NOT NULL,
  "plan_price_id" TEXT,
  "order_code" TEXT NOT NULL,
  "status" "PaymentOrderStatus" NOT NULL DEFAULT 'PENDING',
  "amount" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'VND',
  "billing_months" INTEGER NOT NULL,
  "plan_code_snapshot" TEXT NOT NULL,
  "plan_name_snapshot" TEXT NOT NULL,
  "provider" TEXT,
  "provider_order_id" TEXT,
  "provider_transaction_id" TEXT,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "paid_at" TIMESTAMP(3),
  "applied_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "payment_orders_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "payment_orders_order_code_key" ON "payment_orders"("order_code");
CREATE INDEX "payment_orders_organization_id_status_idx" ON "payment_orders"("organization_id", "status");
CREATE INDEX "payment_orders_organization_id_created_at_idx" ON "payment_orders"("organization_id", "created_at");

ALTER TABLE "payment_orders"
  ADD CONSTRAINT "payment_orders_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "payment_orders"
  ADD CONSTRAINT "payment_orders_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "payment_orders"
  ADD CONSTRAINT "payment_orders_plan_id_fkey"
  FOREIGN KEY ("plan_id") REFERENCES "subscription_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "payment_orders"
  ADD CONSTRAINT "payment_orders_plan_price_id_fkey"
  FOREIGN KEY ("plan_price_id") REFERENCES "subscription_plan_prices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Payment events (webhook idempotency foundation for M2.8)
CREATE TABLE "payment_events" (
  "id" TEXT NOT NULL,
  "payment_order_id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "external_event_id" TEXT NOT NULL,
  "event_type" TEXT NOT NULL,
  "payload" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "payment_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "payment_events_provider_external_event_id_key" ON "payment_events"("provider", "external_event_id");
CREATE INDEX "payment_events_payment_order_id_idx" ON "payment_events"("payment_order_id");

ALTER TABLE "payment_events"
  ADD CONSTRAINT "payment_events_payment_order_id_fkey"
  FOREIGN KEY ("payment_order_id") REFERENCES "payment_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
