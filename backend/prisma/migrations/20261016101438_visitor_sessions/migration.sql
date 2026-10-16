-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "usedOwnKeys" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "visitorId" TEXT;

-- CreateIndex
CREATE INDEX "Job_visitorId_createdAt_idx" ON "Job"("visitorId", "createdAt");
