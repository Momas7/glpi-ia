-- CreateEnum
CREATE TYPE "IncidentStatus" AS ENUM ('OPEN', 'CLOSED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AiSuggestionKind" ADD VALUE 'DUPLICATE';
ALTER TYPE "AiSuggestionKind" ADD VALUE 'SUMMARY';

-- AlterTable
ALTER TABLE "Ticket" ADD COLUMN     "incidentGroupId" TEXT;

-- CreateTable
CREATE TABLE "IncidentGroup" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "IncidentStatus" NOT NULL DEFAULT 'OPEN',
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "closedById" TEXT,

    CONSTRAINT "IncidentGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpenTicketVector" (
    "ticketId" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "embedding" vector(768) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OpenTicketVector_pkey" PRIMARY KEY ("ticketId")
);

-- CreateIndex
CREATE INDEX "IncidentGroup_status_idx" ON "IncidentGroup"("status");

-- CreateIndex
CREATE INDEX "Ticket_incidentGroupId_idx" ON "Ticket"("incidentGroupId");

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_incidentGroupId_fkey" FOREIGN KEY ("incidentGroupId") REFERENCES "IncidentGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentGroup" ADD CONSTRAINT "IncidentGroup_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpenTicketVector" ADD CONSTRAINT "OpenTicketVector_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Busca por similaridade de cosseno entre chamados abertos (pgvector)
CREATE INDEX "OpenTicketVector_embedding_hnsw_idx" ON "OpenTicketVector" USING hnsw ("embedding" vector_cosine_ops);
