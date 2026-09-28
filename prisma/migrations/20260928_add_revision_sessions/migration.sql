-- CreateEnum
CREATE TYPE "RevisionType" AS ENUM ('TEXT', 'IMAGE', 'VIDEO', 'TEXT_AND_MEDIA');
CREATE TYPE "RevisionStatus" AS ENUM ('WAITING_FEEDBACK', 'PROCESSING', 'COMPLETED', 'CANCELLED', 'EXPIRED');

-- CreateTable
CREATE TABLE "revision_sessions" (
    "id" TEXT NOT NULL,
    "content_item_id" TEXT NOT NULL,
    "chat_id" TEXT,
    "user_id" TEXT,
    "source_message_id" INTEGER,
    "prompt_message_id" INTEGER,
    "revision_type" "RevisionType" NOT NULL,
    "selected_media_ids" JSONB,
    "status" "RevisionStatus" NOT NULL DEFAULT 'WAITING_FEEDBACK',
    "feedback_text" TEXT,
    "source" TEXT NOT NULL DEFAULT 'TELEGRAM',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3),

    CONSTRAINT "revision_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "revision_sessions_chat_id_source_message_id_idx" ON "revision_sessions"("chat_id", "source_message_id");
CREATE INDEX "revision_sessions_chat_id_prompt_message_id_idx" ON "revision_sessions"("chat_id", "prompt_message_id");
CREATE INDEX "revision_sessions_content_item_id_status_idx" ON "revision_sessions"("content_item_id", "status");

-- AddForeignKey
ALTER TABLE "revision_sessions" ADD CONSTRAINT "revision_sessions_content_item_id_fkey" FOREIGN KEY ("content_item_id") REFERENCES "content_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
