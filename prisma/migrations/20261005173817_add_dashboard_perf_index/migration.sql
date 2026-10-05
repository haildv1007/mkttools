-- CreateIndex
CREATE INDEX "content_items_organization_id_status_published_at_idx" ON "content_items"("organization_id", "status", "published_at");
