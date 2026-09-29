-- Milestone 1: Multi-tenant SaaS foundation

-- Enums
CREATE TYPE "OrganizationStatus" AS ENUM ('ACTIVE', 'SUSPENDED');
CREATE TYPE "OrgMemberRole" AS ENUM ('OWNER', 'ADMIN', 'MANAGER', 'MEMBER');
CREATE TYPE "OrgMemberStatus" AS ENUM ('ACTIVE', 'INVITED', 'DISABLED');
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'CANCELLED');

-- Users: platform admin flag
ALTER TABLE "users" ADD COLUMN "is_platform_admin" BOOLEAN NOT NULL DEFAULT false;

-- Organizations
CREATE TABLE "organizations" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT,
  "owner_user_id" TEXT,
  "status" "OrganizationStatus" NOT NULL DEFAULT 'ACTIVE',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_owner_user_id_fkey"
  FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Organization members
CREATE TABLE "organization_members" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "role" "OrgMemberRole" NOT NULL DEFAULT 'MEMBER',
  "status" "OrgMemberStatus" NOT NULL DEFAULT 'ACTIVE',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "organization_members_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "organization_members_organization_id_user_id_key" ON "organization_members"("organization_id", "user_id");
CREATE INDEX "organization_members_user_id_idx" ON "organization_members"("user_id");
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Subscription plans
CREATE TABLE "subscription_plans" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "max_pages" INTEGER,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "subscription_plans_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "subscription_plans_code_key" ON "subscription_plans"("code");

-- Organization subscriptions
CREATE TABLE "organization_subscriptions" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "plan_id" TEXT NOT NULL,
  "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
  "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMP(3),
  "custom_max_pages" INTEGER,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "organization_subscriptions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "organization_subscriptions_organization_id_status_idx" ON "organization_subscriptions"("organization_id", "status");
ALTER TABLE "organization_subscriptions" ADD CONSTRAINT "organization_subscriptions_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "organization_subscriptions" ADD CONSTRAINT "organization_subscriptions_plan_id_fkey"
  FOREIGN KEY ("plan_id") REFERENCES "subscription_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Seed plans + default organization
DO $$
DECLARE
  v_org_id TEXT;
  v_plan_id TEXT;
  v_owner_id TEXT;
BEGIN
  -- Seed plans (idempotent-ish via code uniqueness; migration runs once anyway)
  INSERT INTO "subscription_plans" ("id", "code", "name", "max_pages", "sort_order", "updated_at") VALUES
    ('plan_starter_3',   'STARTER_3',     'Starter',    3,    10, NOW()),
    ('plan_basic_5',     'BASIC_5',       'Basic',      5,    20, NOW()),
    ('plan_pro_10',      'PRO_10',        'Pro',        10,   30, NOW()),
    ('plan_business_20', 'BUSINESS_20',   'Business',   20,   40, NOW()),
    ('plan_agency_50',   'AGENCY_50',     'Agency',     50,   50, NOW()),
    ('plan_enterprise',  'ENTERPRISE',    'Enterprise', NULL, 60, NOW());

  -- Pick default owner: OWNER role first, oldest; else first user.
  SELECT id INTO v_owner_id FROM "users" WHERE role = 'OWNER' ORDER BY created_at ASC LIMIT 1;
  IF v_owner_id IS NULL THEN
    SELECT id INTO v_owner_id FROM "users" ORDER BY created_at ASC LIMIT 1;
  END IF;

  -- Create default organization only if there is existing data or at least one user
  IF v_owner_id IS NOT NULL OR EXISTS (SELECT 1 FROM "pages") THEN
    v_org_id := 'org_default_mkttools';
    INSERT INTO "organizations" ("id", "name", "slug", "owner_user_id", "status", "updated_at")
      VALUES (v_org_id, 'MKT Tools', 'mkt-tools', v_owner_id, 'ACTIVE', NOW());

    -- Owner + all existing users become members (owner=OWNER, others=ADMIN)
    INSERT INTO "organization_members" ("id", "organization_id", "user_id", "role", "status", "updated_at")
      SELECT 'orgm_' || u.id, v_org_id, u.id,
             CASE WHEN u.id = v_owner_id THEN 'OWNER'::"OrgMemberRole"
                  WHEN u.role = 'OWNER' THEN 'ADMIN'::"OrgMemberRole"
                  WHEN u.role = 'ADMIN' THEN 'ADMIN'::"OrgMemberRole"
                  ELSE 'MEMBER'::"OrgMemberRole" END,
             'ACTIVE'::"OrgMemberStatus",
             NOW()
        FROM "users" u;

    -- Assign ENTERPRISE plan so existing pages are never over-limit at deploy
    SELECT id INTO v_plan_id FROM "subscription_plans" WHERE code = 'ENTERPRISE';
    INSERT INTO "organization_subscriptions" ("id", "organization_id", "plan_id", "status", "started_at", "updated_at")
      VALUES ('orgsub_default', v_org_id, v_plan_id, 'ACTIVE', NOW(), NOW());
  END IF;
END $$;

-- Pages: add organization_id, backfill, then NOT NULL + FK + new unique + indexes
ALTER TABLE "pages" ADD COLUMN "organization_id" TEXT;
UPDATE "pages" SET "organization_id" = 'org_default_mkttools' WHERE "organization_id" IS NULL;
ALTER TABLE "pages" ALTER COLUMN "organization_id" SET NOT NULL;
ALTER TABLE "pages" DROP CONSTRAINT IF EXISTS "pages_platform_external_id_key";
DROP INDEX IF EXISTS "pages_platform_external_id_key";
CREATE UNIQUE INDEX "pages_organization_id_platform_external_id_key" ON "pages"("organization_id", "platform", "external_id");
CREATE INDEX "pages_organization_id_is_active_idx" ON "pages"("organization_id", "is_active");
ALTER TABLE "pages" ADD CONSTRAINT "pages_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Workspaces
ALTER TABLE "workspaces" ADD COLUMN "organization_id" TEXT;
UPDATE "workspaces" SET "organization_id" = 'org_default_mkttools' WHERE "organization_id" IS NULL;
ALTER TABLE "workspaces" ALTER COLUMN "organization_id" SET NOT NULL;
CREATE INDEX "workspaces_organization_id_idx" ON "workspaces"("organization_id");
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Campaigns
ALTER TABLE "campaigns" ADD COLUMN "organization_id" TEXT;
UPDATE "campaigns" c SET "organization_id" = p."organization_id"
  FROM "pages" p WHERE c."page_id" = p."id" AND c."organization_id" IS NULL;
UPDATE "campaigns" SET "organization_id" = 'org_default_mkttools' WHERE "organization_id" IS NULL;
ALTER TABLE "campaigns" ALTER COLUMN "organization_id" SET NOT NULL;
CREATE INDEX "campaigns_organization_id_is_active_idx" ON "campaigns"("organization_id", "is_active");
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Content items
ALTER TABLE "content_items" ADD COLUMN "organization_id" TEXT;
UPDATE "content_items" ci SET "organization_id" = p."organization_id"
  FROM "pages" p WHERE ci."page_id" = p."id" AND ci."organization_id" IS NULL;
UPDATE "content_items" SET "organization_id" = 'org_default_mkttools' WHERE "organization_id" IS NULL;
ALTER TABLE "content_items" ALTER COLUMN "organization_id" SET NOT NULL;
CREATE INDEX "content_items_organization_id_status_idx" ON "content_items"("organization_id", "status");
CREATE INDEX "content_items_organization_id_created_at_idx" ON "content_items"("organization_id", "created_at");
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Activity logs (nullable — legacy rows keep NULL)
ALTER TABLE "activity_logs" ADD COLUMN "organization_id" TEXT;
CREATE INDEX "activity_logs_organization_id_created_at_idx" ON "activity_logs"("organization_id", "created_at");
