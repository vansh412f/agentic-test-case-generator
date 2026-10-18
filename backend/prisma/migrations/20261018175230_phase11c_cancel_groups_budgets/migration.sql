-- AlterEnum
ALTER TYPE "JobStatus" ADD VALUE 'cancelled';

-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "ipHash" TEXT,
ADD COLUMN     "runGroupId" UUID;

-- CreateIndex
CREATE INDEX "Job_ipHash_createdAt_idx" ON "Job"("ipHash", "createdAt");

-- CreateIndex
CREATE INDEX "Job_runGroupId_idx" ON "Job"("runGroupId");
