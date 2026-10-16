-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('pending', 'crawling', 'planning', 'generating', 'executing', 'completed', 'failed');

-- CreateEnum
CREATE TYPE "StepType" AS ENUM ('crawl', 'plan', 'generate', 'validate', 'execute', 'correct');

-- CreateEnum
CREATE TYPE "StepStatus" AS ENUM ('success', 'failure');

-- CreateEnum
CREATE TYPE "TestStatus" AS ENUM ('passed', 'failed', 'gave_up');

-- CreateEnum
CREATE TYPE "FailureClass" AS ENUM ('finding', 'locator', 'timeout', 'other');

-- CreateTable
CREATE TABLE "Job" (
    "id" UUID NOT NULL,
    "targetUrl" TEXT NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'pending',
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "appMap" JSONB,
    "testPlan" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentStep" (
    "id" UUID NOT NULL,
    "jobId" UUID NOT NULL,
    "stepType" "StepType" NOT NULL,
    "testCaseId" TEXT,
    "attemptNumber" INTEGER,
    "status" "StepStatus" NOT NULL,
    "latencyMs" INTEGER,
    "llmProvider" TEXT,
    "llmModel" TEXT,
    "promptTokens" INTEGER,
    "completionTokens" INTEGER,
    "errorDetail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GeneratedTest" (
    "id" UUID NOT NULL,
    "jobId" UUID NOT NULL,
    "testCaseId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "finalCode" TEXT NOT NULL,
    "finalStatus" "TestStatus" NOT NULL,
    "totalAttempts" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GeneratedTest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExecutionResult" (
    "id" UUID NOT NULL,
    "generatedTestId" UUID NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "validationPassed" BOOLEAN NOT NULL,
    "validationErrors" JSONB,
    "executionPassed" BOOLEAN,
    "executionError" TEXT,
    "failureClass" "FailureClass",
    "durationMs" INTEGER,
    "corrected" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExecutionResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Job_createdAt_id_idx" ON "Job"("createdAt", "id");

-- CreateIndex
CREATE INDEX "AgentStep_jobId_idx" ON "AgentStep"("jobId");

-- CreateIndex
CREATE INDEX "GeneratedTest_jobId_idx" ON "GeneratedTest"("jobId");

-- CreateIndex
CREATE UNIQUE INDEX "GeneratedTest_jobId_testCaseId_key" ON "GeneratedTest"("jobId", "testCaseId");

-- CreateIndex
CREATE UNIQUE INDEX "GeneratedTest_jobId_filename_key" ON "GeneratedTest"("jobId", "filename");

-- CreateIndex
CREATE INDEX "ExecutionResult_generatedTestId_idx" ON "ExecutionResult"("generatedTestId");

-- CreateIndex
CREATE UNIQUE INDEX "ExecutionResult_generatedTestId_attemptNumber_key" ON "ExecutionResult"("generatedTestId", "attemptNumber");

-- AddForeignKey
ALTER TABLE "AgentStep" ADD CONSTRAINT "AgentStep_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratedTest" ADD CONSTRAINT "GeneratedTest_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExecutionResult" ADD CONSTRAINT "ExecutionResult_generatedTestId_fkey" FOREIGN KEY ("generatedTestId") REFERENCES "GeneratedTest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
