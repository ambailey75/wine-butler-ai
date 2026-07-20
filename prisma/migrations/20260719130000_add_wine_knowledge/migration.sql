-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- CreateEnum
CREATE TYPE "SourceTrust" AS ENUM ('X_WINES', 'LWIN', 'USER_CONFIRMED', 'LEGACY_MANUAL', 'VIVINO', 'AI_ESTIMATE');

-- CreateTable
CREATE TABLE "wine_knowledge" (
    "id" TEXT NOT NULL,
    "producer" TEXT NOT NULL,
    "wineName" TEXT NOT NULL,
    "vintage" INTEGER,
    "country" TEXT,
    "state" TEXT,
    "region" TEXT,
    "subRegion" TEXT,
    "appellation" TEXT,
    "vineyard" TEXT,
    "classification" TEXT,
    "varietal" TEXT,
    "normalizedProducer" TEXT NOT NULL,
    "normalizedWineName" TEXT NOT NULL,
    "searchText" TEXT NOT NULL,
    "sourceTrust" "SourceTrust" NOT NULL,
    "xWinesId" TEXT,
    "lwinCode" TEXT,
    "lwinStatus" TEXT,
    "lwinDisplayName" TEXT,
    "avgRating" DECIMAL(3,2),
    "ratingCount" INTEGER,
    "wineSearcherPrice" DECIMAL(10,2),
    "confirmedCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wine_knowledge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "wine_knowledge_xWinesId_key" ON "wine_knowledge"("xWinesId");

-- CreateIndex
CREATE UNIQUE INDEX "wine_knowledge_lwinCode_key" ON "wine_knowledge"("lwinCode");

-- CreateIndex
CREATE INDEX "wine_knowledge_normalizedProducer_normalizedWineName_vinta_idx" ON "wine_knowledge"("normalizedProducer", "normalizedWineName", "vintage");

-- CreateIndex
CREATE INDEX "wine_knowledge_producer_idx" ON "wine_knowledge"("producer");

-- CreateIndex
CREATE INDEX "wine_knowledge_sourceTrust_idx" ON "wine_knowledge"("sourceTrust");

-- CreateIndex (fuzzy search -- gin_trgm_ops requires the pg_trgm extension created above)
CREATE INDEX "wine_knowledge_searchText_idx" ON "wine_knowledge" USING GIN ("searchText" gin_trgm_ops);
