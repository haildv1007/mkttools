-- BYOK: the customer explicitly picks provider + model per operation
-- (OrganizationAiOperationSetting). The old FAST/BALANCED/QUALITY tier
-- system is fully removed from the app; this column is unused and its
-- values are no longer read anywhere.
ALTER TABLE "organization_ai_credentials" DROP COLUMN "default_quality";

DROP TYPE "AiQualityTier";
