-- AlterTable
ALTER TABLE "content_items" ADD COLUMN IF NOT EXISTS "generated_images" JSONB;
ALTER TABLE "content_items" ADD COLUMN IF NOT EXISTS "image_descriptions" TEXT;
