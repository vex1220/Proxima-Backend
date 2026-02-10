-- AlterTable
ALTER TABLE "ChatRoomMessage" ADD COLUMN     "isReply" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "replyToId" INTEGER;
