-- Organization-scoped customer integration settings.
CREATE TABLE "organization_settings" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "is_secret" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "organization_settings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "organization_settings_organization_id_key_key"
  ON "organization_settings"("organization_id", "key");
CREATE INDEX "organization_settings_organization_id_idx"
  ON "organization_settings"("organization_id");
ALTER TABLE "organization_settings"
  ADD CONSTRAINT "organization_settings_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- The SaaS migration assigned all legacy data to this organization. Preserve
-- its legacy Telegram/Facebook/timezone values without copying them to newer
-- tenants. AI keys are intentionally not copied; OrganizationAiCredential is
-- already the only customer AI credential source of truth.
INSERT INTO "organization_settings"
  ("id", "organization_id", "key", "value", "is_secret", "updated_at")
SELECT
  'orgset_' || md5(a."key"),
  'org_default_mkttools',
  a."key",
  a."value",
  a."key" IN ('TELEGRAM_BOT_TOKEN', 'FACEBOOK_APP_SECRET'),
  NOW()
FROM "app_settings" a
WHERE a."key" IN (
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_ADMIN_CHAT_IDS',
  'FACEBOOK_APP_ID',
  'FACEBOOK_APP_SECRET',
  'DEFAULT_TIMEZONE'
)
AND EXISTS (SELECT 1 FROM "organizations" o WHERE o."id" = 'org_default_mkttools')
ON CONFLICT ("organization_id", "key") DO NOTHING;
