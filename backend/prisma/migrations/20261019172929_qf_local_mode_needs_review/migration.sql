-- AlterEnum
ALTER TYPE "TestStatus" ADD VALUE 'needs_review';

-- AlterTable
ALTER TABLE "ExecutionResult" ADD COLUMN     "failureContext" JSONB;

-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "quotaExempt" BOOLEAN NOT NULL DEFAULT false;
