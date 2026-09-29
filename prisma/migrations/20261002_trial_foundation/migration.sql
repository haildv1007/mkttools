-- Trial foundation migration

-- Add TRIAL to SubscriptionStatus enum
ALTER TYPE "SubscriptionStatus" ADD VALUE IF NOT EXISTS 'TRIAL';

-- Add trial columns to organization_subscriptions
ALTER TABLE "organization_subscriptions"
  ADD COLUMN IF NOT EXISTS "trial_started_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "trial_ends_at"    TIMESTAMP(3);

-- Trial policy (single-row config; platform admin can edit via M2.5)
CREATE TABLE "trial_policy" (
  "id"               TEXT NOT NULL DEFAULT 'trial_policy_singleton',
  "trial_enabled"    BOOLEAN NOT NULL DEFAULT true,
  "trial_days"       INTEGER NOT NULL DEFAULT 7,
  "trial_max_pages"  INTEGER NOT NULL DEFAULT 2,
  "trial_max_members" INTEGER NOT NULL DEFAULT 2,
  "updated_at"       TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  CONSTRAINT "trial_policy_pkey" PRIMARY KEY ("id")
);

-- Seed default trial policy (safe defaults, editable by Platform Admin later)
INSERT INTO "trial_policy" ("id", "trial_enabled", "trial_days", "trial_max_pages", "trial_max_members", "updated_at")
  VALUES ('trial_policy_singleton', true, 7, 2, 2, NOW())
  ON CONFLICT ("id") DO NOTHING;

-- User trial entitlement: one per user who has consumed a trial (prevents second free trial)
CREATE TABLE "user_trial_entitlements" (
  "id"              TEXT NOT NULL,
  "user_id"         TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "started_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "user_trial_entitlements_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "user_trial_entitlements_user_id_key" ON "user_trial_entitlements"("user_id");
ALTER TABLE "user_trial_entitlements"
  ADD CONSTRAINT "user_trial_entitlements_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
