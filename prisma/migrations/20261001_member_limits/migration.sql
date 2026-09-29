-- Add max_members to subscription_plans
ALTER TABLE "subscription_plans" ADD COLUMN "max_members" INTEGER;

-- Add custom_max_members to organization_subscriptions
ALTER TABLE "organization_subscriptions" ADD COLUMN "custom_max_members" INTEGER;

-- Seed default max_members for existing plans (matching page limits as reasonable defaults)
UPDATE "subscription_plans" SET "max_members" = 3  WHERE "code" = 'STARTER_3';
UPDATE "subscription_plans" SET "max_members" = 5  WHERE "code" = 'BASIC_5';
UPDATE "subscription_plans" SET "max_members" = 10 WHERE "code" = 'PRO_10';
UPDATE "subscription_plans" SET "max_members" = 20 WHERE "code" = 'BUSINESS_20';
UPDATE "subscription_plans" SET "max_members" = 50 WHERE "code" = 'AGENCY_50';
-- ENTERPRISE: NULL = unlimited
