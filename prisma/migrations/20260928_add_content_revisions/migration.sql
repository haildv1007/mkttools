CREATE TABLE IF NOT EXISTS "content_revisions" (
    "id" TEXT NOT NULL,
    "content_item_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "generated_text" TEXT,
    "generated_images" JSONB,
    "feedback" TEXT,
    "source" TEXT NOT NULL DEFAULT 'WEB',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "content_revisions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "content_revisions_content_item_id_version_key" ON "content_revisions"("content_item_id", "version");
CREATE INDEX IF NOT EXISTS "content_revisions_content_item_id_idx" ON "content_revisions"("content_item_id");

ALTER TABLE "content_revisions" ADD CONSTRAINT "content_revisions_content_item_id_fkey" FOREIGN KEY ("content_item_id") REFERENCES "content_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
