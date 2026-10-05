-- AlterTable
ALTER TABLE "Comment" ADD COLUMN     "sources" JSONB;

-- AlterTable
ALTER TABLE "Ticket" ADD COLUMN     "resolution" TEXT;

-- CreateTable
CREATE TABLE "TicketRating" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "raterId" TEXT NOT NULL,
    "stars" INTEGER NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketRating_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KbArticle" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KbArticle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KbChunk" (
    "id" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "embedding" vector(768),

    CONSTRAINT "KbChunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketEmbedding" (
    "ticketId" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "embedding" vector(768) NOT NULL,
    "indexedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketEmbedding_pkey" PRIMARY KEY ("ticketId")
);

-- CreateIndex
CREATE UNIQUE INDEX "TicketRating_ticketId_key" ON "TicketRating"("ticketId");

-- CreateIndex
CREATE INDEX "KbArticle_published_idx" ON "KbArticle"("published");

-- CreateIndex
CREATE INDEX "KbChunk_articleId_idx" ON "KbChunk"("articleId");

-- AddForeignKey
ALTER TABLE "TicketRating" ADD CONSTRAINT "TicketRating_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketRating" ADD CONSTRAINT "TicketRating_raterId_fkey" FOREIGN KEY ("raterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KbArticle" ADD CONSTRAINT "KbArticle_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KbArticle" ADD CONSTRAINT "KbArticle_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KbChunk" ADD CONSTRAINT "KbChunk_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "KbArticle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketEmbedding" ADD CONSTRAINT "TicketEmbedding_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Avaliação: nota de 1 a 5 e comentário curto (o Prisma não modela CHECK)
ALTER TABLE "TicketRating" ADD CONSTRAINT "TicketRating_stars_check" CHECK ("stars" BETWEEN 1 AND 5);
ALTER TABLE "TicketRating" ADD CONSTRAINT "TicketRating_comment_check" CHECK ("comment" IS NULL OR char_length("comment") <= 1000);

-- Busca por similaridade de cosseno (pgvector)
CREATE INDEX "KbChunk_embedding_hnsw_idx" ON "KbChunk" USING hnsw ("embedding" vector_cosine_ops);
CREATE INDEX "TicketEmbedding_embedding_hnsw_idx" ON "TicketEmbedding" USING hnsw ("embedding" vector_cosine_ops);
