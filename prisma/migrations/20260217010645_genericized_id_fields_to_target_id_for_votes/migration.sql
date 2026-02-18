/*
  Warnings:

  - You are about to drop the column `messageId` on the `ChatRoomMessageVote` table. All the data in the column will be lost.
  - You are about to drop the column `postId` on the `PostVote` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[userId,targetId]` on the table `ChatRoomMessageVote` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[userId,targetId]` on the table `PostVote` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `targetId` to the `ChatRoomMessageVote` table without a default value. This is not possible if the table is not empty.
  - Added the required column `targetId` to the `PostVote` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "ChatRoomMessageVote" DROP CONSTRAINT "ChatRoomMessageVote_messageId_fkey";

-- DropForeignKey
ALTER TABLE "PostVote" DROP CONSTRAINT "PostVote_postId_fkey";

-- DropIndex
DROP INDEX "ChatRoomMessageVote_userId_messageId_key";

-- DropIndex
DROP INDEX "PostVote_userId_postId_key";

-- AlterTable
ALTER TABLE "ChatRoomMessageVote" DROP COLUMN "messageId",
ADD COLUMN     "targetId" INTEGER NOT NULL;

-- AlterTable
ALTER TABLE "PostVote" DROP COLUMN "postId",
ADD COLUMN     "targetId" INTEGER NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "ChatRoomMessageVote_userId_targetId_key" ON "ChatRoomMessageVote"("userId", "targetId");

-- CreateIndex
CREATE UNIQUE INDEX "PostVote_userId_targetId_key" ON "PostVote"("userId", "targetId");

-- AddForeignKey
ALTER TABLE "PostVote" ADD CONSTRAINT "PostVote_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatRoomMessageVote" ADD CONSTRAINT "ChatRoomMessageVote_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "ChatRoomMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
