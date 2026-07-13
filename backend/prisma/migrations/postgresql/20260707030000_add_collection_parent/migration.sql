-- Pastas aninhadas (subpastas): auto-relacionamento em Collection.
-- AlterTable
ALTER TABLE "Collection" ADD COLUMN "parentId" TEXT;

-- CreateIndex
CREATE INDEX "Collection_parentId_idx" ON "Collection"("parentId");

-- AddForeignKey (subpasta some junto com a pasta-mãe)
ALTER TABLE "Collection" ADD CONSTRAINT "Collection_parentId_fkey"
  FOREIGN KEY ("parentId") REFERENCES "Collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
