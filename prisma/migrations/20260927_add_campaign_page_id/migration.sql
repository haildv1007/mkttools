-- AlterTable: add page_id to campaigns (nullable first for existing data)
ALTER TABLE "campaigns" ADD COLUMN "page_id" TEXT;

-- Backfill: set page_id from the first content item's page_id for existing campaigns
UPDATE "campaigns" c SET "page_id" = (
  SELECT ci."page_id" FROM "content_items" ci WHERE ci."campaign_id" = c."id" LIMIT 1
);

-- For campaigns with no content items, assign first active page
UPDATE "campaigns" SET "page_id" = (SELECT "id" FROM "pages" WHERE "is_active" = true LIMIT 1)
WHERE "page_id" IS NULL;

-- Make it required
ALTER TABLE "campaigns" ALTER COLUMN "page_id" SET NOT NULL;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "pages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
