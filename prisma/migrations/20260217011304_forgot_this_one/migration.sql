/*
  Warnings:

  - You are about to drop the column `postCommentId` on the `PostCommentVote` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[userId,targetId]` on the table `PostCommentVote` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `targetId` to the `PostCommentVote` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "PostCommentVote" DROP CONSTRAINT "PostCommentVote_postCommentId_fkey";

-- DropIndex
DROP INDEX "PostCommentVote_userId_postCommentId_key";

-- AlterTable
ALTER TABLE "PostCommentVote" DROP COLUMN "postCommentId",
ADD COLUMN     "targetId" INTEGER NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "PostCommentVote_userId_targetId_key" ON "PostCommentVote"("userId", "targetId");

-- AddForeignKey
ALTER TABLE "PostCommentVote" ADD CONSTRAINT "PostCommentVote_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "PostComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
