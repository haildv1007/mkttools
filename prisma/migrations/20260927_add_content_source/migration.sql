-- CreateEnum
CREATE TYPE "ContentSource" AS ENUM ('AI', 'MANUAL', 'IMPORT');

-- AlterTable
ALTER TABLE "content_items" ADD COLUMN "source" "ContentSource" NOT NULL DEFAULT 'AI';
