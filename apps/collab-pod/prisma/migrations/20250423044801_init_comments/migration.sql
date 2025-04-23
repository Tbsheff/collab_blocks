-- CreateTable
CREATE TABLE "comments" (
    "id" TEXT NOT NULL,
    "room_id" BIGINT NOT NULL,
    "block_id" TEXT NOT NULL,
    "parent_id" TEXT,
    "path" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "body_md" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comment_reactions" (
    "comment_id" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comment_reactions_pkey" PRIMARY KEY ("comment_id","emoji","user_id")
);

-- CreateIndex
CREATE INDEX "idx_comments_room" ON "comments"("room_id");

-- CreateIndex
CREATE INDEX "idx_comments_block" ON "comments"("block_id");

-- CreateIndex
CREATE INDEX "idx_reactions_comment" ON "comment_reactions"("comment_id");

-- AddForeignKey
ALTER TABLE "comment_reactions" ADD CONSTRAINT "comment_reactions_comment_id_fkey" FOREIGN KEY ("comment_id") REFERENCES "comments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
