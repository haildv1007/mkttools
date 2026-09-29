-- CreateEnum
CREATE TYPE "AiOperation" AS ENUM ('TEXT_GENERATION', 'TEXT_REVISION', 'IMAGE_GENERATION', 'IMAGE_REVISION', 'VIDEO_GENERATION');

-- CreateTable
CREATE TABLE "organization_ai_operation_settings" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "operation" "AiOperation" NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organization_ai_operation_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organization_ai_operation_settings_organization_id_operation_key" ON "organization_ai_operation_settings"("organization_id", "operation");

-- AddForeignKey
ALTER TABLE "organization_ai_operation_settings" ADD CONSTRAINT "organization_ai_operation_settings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
