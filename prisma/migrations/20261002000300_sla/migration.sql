-- AlterTable
ALTER TABLE "Ticket" ADD COLUMN     "firstRespondedAt" TIMESTAMP(3),
ADD COLUMN     "firstResponseBusinessMinutes" INTEGER,
ADD COLUMN     "firstResponseDue" TIMESTAMP(3),
ADD COLUMN     "pausedAt" TIMESTAMP(3),
ADD COLUMN     "pausedMinutes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "resolutionBusinessMinutes" INTEGER,
ADD COLUMN     "resolutionDue" TIMESTAMP(3),
ADD COLUMN     "slaBreachedAt" TIMESTAMP(3),
ADD COLUMN     "slaFirstResponseMinutes" INTEGER,
ADD COLUMN     "slaResolutionMinutes" INTEGER,
ADD COLUMN     "slaWarnedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "SlaPolicy" (
    "id" TEXT NOT NULL,
    "priority" "Priority" NOT NULL,
    "firstResponseMinutes" INTEGER NOT NULL,
    "resolutionMinutes" INTEGER NOT NULL,

    CONSTRAINT "SlaPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessHours" (
    "id" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,

    CONSTRAINT "BusinessHours_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Holiday" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Holiday_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SlaPolicy_priority_key" ON "SlaPolicy"("priority");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessHours_weekday_key" ON "BusinessHours"("weekday");

-- CreateIndex
CREATE UNIQUE INDEX "Holiday_date_key" ON "Holiday"("date");


-- Prazos de chamados ainda em andamento (filtros de SLA e varredura do job)
CREATE INDEX "Ticket_resolutionDue_open_idx" ON "Ticket"("resolutionDue") WHERE status NOT IN ('RESOLVED', 'CLOSED');
