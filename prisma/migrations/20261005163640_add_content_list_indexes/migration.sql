-- AlterTable
ALTER TABLE "trial_policy" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- CreateIndex
CREATE INDEX "content_items_organization_id_scheduled_at_idx" ON "content_items"("organization_id", "scheduled_at");

-- CreateIndex
CREATE INDEX "content_items_organization_id_page_id_status_idx" ON "content_items"("organization_id", "page_id", "status");

-- CreateIndex
CREATE INDEX "content_items_campaign_id_idx" ON "content_items"("campaign_id");

-- CreateIndex
CREATE INDEX "content_items_source_idx" ON "content_items"("source");

-- RenameForeignKey
ALTER TABLE "organization_ai_credentials" RENAME CONSTRAINT "oac_org_fk" TO "organization_ai_credentials_organization_id_fkey";

-- RenameForeignKey
ALTER TABLE "organization_member_pages" RENAME CONSTRAINT "omp_member_fk" TO "organization_member_pages_organization_member_id_fkey";

-- RenameForeignKey
ALTER TABLE "organization_member_pages" RENAME CONSTRAINT "omp_page_fk" TO "organization_member_pages_page_id_fkey";

-- RenameForeignKey
ALTER TABLE "organization_member_workspaces" RENAME CONSTRAINT "omw_member_fk" TO "organization_member_workspaces_organization_member_id_fkey";

-- RenameForeignKey
ALTER TABLE "organization_member_workspaces" RENAME CONSTRAINT "omw_workspace_fk" TO "organization_member_workspaces_workspace_id_fkey";

-- RenameIndex
ALTER INDEX "oac_org_provider_key" RENAME TO "organization_ai_credentials_organization_id_provider_key";

-- RenameIndex
ALTER INDEX "organization_ai_operation_settings_organization_id_operation_ke" RENAME TO "organization_ai_operation_settings_organization_id_operatio_key";

-- RenameIndex
ALTER INDEX "omp_member_page_key" RENAME TO "organization_member_pages_organization_member_id_page_id_key";

-- RenameIndex
ALTER INDEX "omp_page_idx" RENAME TO "organization_member_pages_page_id_idx";

-- RenameIndex
ALTER INDEX "omw_member_workspace_key" RENAME TO "organization_member_workspaces_organization_member_id_works_key";

-- RenameIndex
ALTER INDEX "omw_workspace_idx" RENAME TO "organization_member_workspaces_workspace_id_idx";
