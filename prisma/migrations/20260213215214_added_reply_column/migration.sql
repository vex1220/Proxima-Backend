/*
  Warnings:

  - You are about to drop the column `karma` on the `ChatRoomMessage` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "ChatRoomType" AS ENUM ('NONE', 'CAMPUS', 'CITY', 'PARTY', 'EVENT', 'GLOBAL', 'BUILDING');

-- AlterTable
ALTER TABLE "ChatRoom" ADD COLUMN     "type" "ChatRoomType" NOT NULL DEFAULT 'NONE';

-- AlterTable
ALTER TABLE "ChatRoomMessage" DROP COLUMN "karma";

-- CreateTable
CREATE TABLE "ChatRoomMessageVote" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "messageId" INTEGER NOT NULL,
    "value" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatRoomMessageVote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ChatRoomMessageVote_userId_messageId_key" ON "ChatRoomMessageVote"("userId", "messageId");

-- AddForeignKey
ALTER TABLE "ChatRoomMessageVote" ADD CONSTRAINT "ChatRoomMessageVote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatRoomMessageVote" ADD CONSTRAINT "ChatRoomMessageVote_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "ChatRoomMessage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
