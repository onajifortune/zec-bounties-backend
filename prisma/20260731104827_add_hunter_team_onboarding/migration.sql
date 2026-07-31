-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "UserRole" ADD VALUE 'PENDING';
ALTER TYPE "UserRole" ADD VALUE 'HUNTER';

-- AlterTable
ALTER TABLE "Bounty" ADD COLUMN     "teamId" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "roleSelectedAt" TIMESTAMP(3),
ALTER COLUMN "role" SET DEFAULT 'PENDING';

-- CreateTable
CREATE TABLE "bounty_reward_tiers" (
    "id" TEXT NOT NULL,
    "bountyId" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "bounty_reward_tiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bounty_winners" (
    "id" TEXT NOT NULL,
    "bountyId" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "rewardAmount" DOUBLE PRECISION NOT NULL,
    "selectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isPaid" BOOLEAN NOT NULL DEFAULT false,
    "paidAt" TIMESTAMP(3),

    CONSTRAINT "bounty_winners_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bounty_reward_tiers_bountyId_idx" ON "bounty_reward_tiers"("bountyId");

-- CreateIndex
CREATE UNIQUE INDEX "bounty_reward_tiers_bountyId_rank_key" ON "bounty_reward_tiers"("bountyId", "rank");

-- CreateIndex
CREATE UNIQUE INDEX "bounty_winners_submissionId_key" ON "bounty_winners"("submissionId");

-- CreateIndex
CREATE INDEX "bounty_winners_bountyId_idx" ON "bounty_winners"("bountyId");

-- CreateIndex
CREATE INDEX "bounty_winners_userId_idx" ON "bounty_winners"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "bounty_winners_bountyId_rank_key" ON "bounty_winners"("bountyId", "rank");

-- CreateIndex
CREATE INDEX "Bounty_teamId_idx" ON "Bounty"("teamId");

-- AddForeignKey
ALTER TABLE "Bounty" ADD CONSTRAINT "Bounty_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bounty_reward_tiers" ADD CONSTRAINT "bounty_reward_tiers_bountyId_fkey" FOREIGN KEY ("bountyId") REFERENCES "Bounty"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bounty_winners" ADD CONSTRAINT "bounty_winners_bountyId_fkey" FOREIGN KEY ("bountyId") REFERENCES "Bounty"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bounty_winners" ADD CONSTRAINT "bounty_winners_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "work_submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bounty_winners" ADD CONSTRAINT "bounty_winners_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
