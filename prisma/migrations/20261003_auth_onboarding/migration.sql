-- M2.6 auth + onboarding
ALTER TABLE "users" ALTER COLUMN "password_hash" DROP NOT NULL;
ALTER TABLE "users"
  ADD COLUMN "email_verified_at" TIMESTAMP(3),
  ADD COLUMN "terms_accepted_at" TIMESTAMP(3),
  ADD COLUMN "onboarding_completed_at" TIMESTAMP(3);

-- Grandfather existing accounts: verified, onboarded.
UPDATE "users" SET "email_verified_at" = NOW(), "terms_accepted_at" = NOW(), "onboarding_completed_at" = NOW();

-- Normalize emails to lower-case where it cannot collide with another account.
UPDATE "users" u SET "email" = lower(btrim(u."email"))
 WHERE u."email" <> lower(btrim(u."email"))
   AND NOT EXISTS (SELECT 1 FROM "users" o WHERE o."id" <> u."id" AND lower(btrim(o."email")) = lower(btrim(u."email")));

CREATE TYPE "AuthTokenType" AS ENUM ('EMAIL_VERIFY', 'PASSWORD_RESET', 'LOGIN_CODE');

CREATE TABLE "user_auth_identities" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "provider_user_id" TEXT NOT NULL,
  "provider_email" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "user_auth_identities_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "user_auth_identities_provider_provider_user_id_key" ON "user_auth_identities"("provider", "provider_user_id");
CREATE INDEX "user_auth_identities_user_id_idx" ON "user_auth_identities"("user_id");
ALTER TABLE "user_auth_identities" ADD CONSTRAINT "user_auth_identities_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "auth_tokens" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "type" "AuthTokenType" NOT NULL,
  "token_hash" TEXT NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "used_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "auth_tokens_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "auth_tokens_token_hash_key" ON "auth_tokens"("token_hash");
CREATE INDEX "auth_tokens_user_id_type_idx" ON "auth_tokens"("user_id", "type");
ALTER TABLE "auth_tokens" ADD CONSTRAINT "auth_tokens_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "user_sessions" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "user_agent" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "revoked_at" TIMESTAMP(3),
  CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "user_sessions_user_id_idx" ON "user_sessions"("user_id");
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
