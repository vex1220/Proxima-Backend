-- CreateTable
CREATE TABLE "User_Settings" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "broadcastRadius" INTEGER NOT NULL DEFAULT 2,
    "recieveRadius" INTEGER NOT NULL DEFAULT 2,

    CONSTRAINT "User_Settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_Settings_userId_key" ON "User_Settings"("userId");

-- AddForeignKey
ALTER TABLE "User_Settings" ADD CONSTRAINT "User_Settings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
