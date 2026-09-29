-- Milestone 2: Agency team access + AI provider credentials

CREATE TYPE "MemberAccessMode" AS ENUM ('ALL', 'RESTRICTED');
CREATE TYPE "AiCredentialSource" AS ENUM ('ORGANIZATION_KEY', 'PERSONAL_KEY', 'PLATFORM_API');
CREATE TYPE "AiCredentialValidation" AS ENUM ('UNTESTED', 'CONNECTED', 'INVALID', 'ERROR');

-- Existing members preserve their current effective access (ALL).
ALTER TABLE "organization_members" ADD COLUMN "access_mode" "MemberAccessMode" NOT NULL DEFAULT 'ALL';

CREATE TABLE "organization_member_workspaces" (
  "id" TEXT NOT NULL,
  "organization_member_id" TEXT NOT NULL,
  "workspace_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "organization_member_workspaces_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "omw_member_workspace_key" ON "organization_member_workspaces"("organization_member_id", "workspace_id");
CREATE INDEX "omw_workspace_idx" ON "organization_member_workspaces"("workspace_id");
ALTER TABLE "organization_member_workspaces"
  ADD CONSTRAINT "omw_member_fk" FOREIGN KEY ("organization_member_id") REFERENCES "organization_members"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "omw_workspace_fk" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "organization_member_pages" (
  "id" TEXT NOT NULL,
  "organization_member_id" TEXT NOT NULL,
  "page_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "organization_member_pages_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "omp_member_page_key" ON "organization_member_pages"("organization_member_id", "page_id");
CREATE INDEX "omp_page_idx" ON "organization_member_pages"("page_id");
ALTER TABLE "organization_member_pages"
  ADD CONSTRAINT "omp_member_fk" FOREIGN KEY ("organization_member_id") REFERENCES "organization_members"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "omp_page_fk" FOREIGN KEY ("page_id") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "organization_ai_credentials" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "source" "AiCredentialSource" NOT NULL DEFAULT 'ORGANIZATION_KEY',
  "encrypted_api_key" TEXT NOT NULL,
  "default_model" TEXT,
  "config" JSONB,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "validation_status" "AiCredentialValidation" NOT NULL DEFAULT 'UNTESTED',
  "validation_message" TEXT,
  "last_validated_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "organization_ai_credentials_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "oac_org_provider_key" ON "organization_ai_credentials"("organization_id", "provider");
ALTER TABLE "organization_ai_credentials"
  ADD CONSTRAINT "oac_org_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
