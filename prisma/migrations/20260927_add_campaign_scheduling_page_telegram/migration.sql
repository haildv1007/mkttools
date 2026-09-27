-- AlterTable
ALTER TABLE "campaigns" ADD COLUMN "gen_lead_time" INTEGER NOT NULL DEFAULT 30;
ALTER TABLE "campaigns" ADD COLUMN "auto_approve" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "pages" ADD COLUMN "telegram_group_id" TEXT;
