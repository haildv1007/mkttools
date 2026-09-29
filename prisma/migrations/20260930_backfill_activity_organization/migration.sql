-- Backfill legacy activity logs into the default migrated organization.
-- Rows tied to a known content item take that item's organization; the rest
-- (pre-tenancy history) belong to the default org. Only runs if it exists.
UPDATE "activity_logs" a SET "organization_id" = c."organization_id"
  FROM "content_items" c
  WHERE a."organization_id" IS NULL AND a."entity_type" = 'content' AND a."entity_id" = c."id";

UPDATE "activity_logs" SET "organization_id" = 'org_default_mkttools'
  WHERE "organization_id" IS NULL
    AND EXISTS (SELECT 1 FROM "organizations" WHERE "id" = 'org_default_mkttools');
