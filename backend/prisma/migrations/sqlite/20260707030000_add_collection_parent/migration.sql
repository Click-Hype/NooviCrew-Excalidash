-- Pastas aninhadas (subpastas) — SQLite
ALTER TABLE "Collection" ADD COLUMN "parentId" TEXT REFERENCES "Collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "Collection_parentId_idx" ON "Collection"("parentId");
