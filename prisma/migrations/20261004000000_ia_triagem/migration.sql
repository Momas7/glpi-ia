-- CreateEnum
CREATE TYPE "AiSuggestionKind" AS ENUM ('TRIAGE');

-- CreateEnum
CREATE TYPE "AiSuggestionStatus" AS ENUM ('PENDING', 'ACCEPTED', 'EDITED', 'REJECTED');

-- CreateEnum
CREATE TYPE "AiOutcome" AS ENUM ('OK', 'FAILED', 'SKIPPED', 'BUDGET');

-- AlterTable
ALTER TABLE "Team" ADD COLUMN     "aiEnabled" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "AiSuggestion" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "kind" "AiSuggestionKind" NOT NULL,
    "payload" JSONB NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "status" "AiSuggestionStatus" NOT NULL DEFAULT 'PENDING',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiSuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiAuditLog" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "jobType" TEXT NOT NULL,
    "ticketId" TEXT,
    "inputTokens" INTEGER NOT NULL,
    "outputTokens" INTEGER NOT NULL,
    "costUsd" DECIMAL(12,6) NOT NULL,
    "latencyMs" INTEGER NOT NULL,
    "inputHash" TEXT NOT NULL,
    "outcome" "AiOutcome" NOT NULL,
    "error" TEXT,
    "maskedInput" TEXT,

    CONSTRAINT "AiAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiSuggestion_status_kind_idx" ON "AiSuggestion"("status", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "AiSuggestion_ticketId_kind_key" ON "AiSuggestion"("ticketId", "kind");

-- CreateIndex
CREATE INDEX "AiAuditLog_createdAt_idx" ON "AiAuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AiAuditLog_jobType_createdAt_idx" ON "AiAuditLog"("jobType", "createdAt");

-- AddForeignKey
ALTER TABLE "AiSuggestion" ADD CONSTRAINT "AiSuggestion_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiSuggestion" ADD CONSTRAINT "AiSuggestion_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

