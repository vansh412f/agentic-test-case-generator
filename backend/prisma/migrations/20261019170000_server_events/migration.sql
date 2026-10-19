-- CreateTable
CREATE TABLE "ServerEvent" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "level" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "message" VARCHAR(500) NOT NULL,
    "context" JSONB,
    "jobId" UUID,
    "fingerprint" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "ServerEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ServerEvent_createdAt_idx" ON "ServerEvent"("createdAt");
