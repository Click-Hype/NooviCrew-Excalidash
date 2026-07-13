import archiver from "archiver";
import { Prisma } from "../../generated/client";
import {
  RegisterImportExportDeps,
  assertSafeArchivePath,
  getUserTrashCollectionId,
  isTrashCollectionId,
  sanitizePathSegment,
  toPublicTrashCollectionId,
} from "./shared";
import { compareCollections } from "../../collections/tree";

export const registerExcalidashExportRoute = (deps: RegisterImportExportDeps) => {
  const {
    app,
    prisma,
    requireAuth,
    asyncHandler,
    getBackendVersion,
    parseJsonField,
  } = deps;

  app.get("/export/excalidash", requireAuth, asyncHandler(async (req, res) => {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    const trashCollectionId = getUserTrashCollectionId(req.user.id);

    const extParam = typeof req.query.ext === "string" ? req.query.ext.toLowerCase() : "";
    const zipSuffix = extParam === "zip";
    const date = new Date().toISOString().split("T")[0];
    const filename = zipSuffix
      ? `excalidash-backup-${date}.excalidash.zip`
      : `excalidash-backup-${date}.excalidash`;

    const exportedAt = new Date().toISOString();
    const drawings = await prisma.drawing.findMany({
      where: { userId: req.user.id },
      include: { collection: true },
    });
    const userCollections = await prisma.collection.findMany({
      where: { userId: req.user.id },
    });

    const hasInternalTrashCollection = userCollections.some((collection) => collection.id === trashCollectionId);
    const normalizedUserCollections = userCollections.filter(
      (collection) => !(hasInternalTrashCollection && collection.id === "trash")
    );
    const hasTrashDrawings = drawings.some((drawing) =>
      isTrashCollectionId(drawing.collectionId, req.user!.id)
    );
    const collectionsToExport = [...normalizedUserCollections];
    if (
      hasTrashDrawings &&
      !collectionsToExport.some((collection) =>
        isTrashCollectionId(collection.id, req.user!.id)
      )
    ) {
      const trash = await prisma.collection.findFirst({
        where: { userId: req.user.id, id: { in: [trashCollectionId, "trash"] } },
      });
      if (trash) collectionsToExport.push(trash);
    }

    const exportSource = `${req.protocol}://${req.get("host")}`;
    const unorganizedFolder = "Unorganized";
    const folderByCollectionId = new Map<string, string>();
    const collectionById = new Map(collectionsToExport.map((collection) => [collection.id, collection]));
    const resolveFolder = (collectionId: string, resolving = new Set<string>()): string => {
      const cached = folderByCollectionId.get(collectionId);
      if (cached) return cached;
      const collection = collectionById.get(collectionId);
      if (!collection || resolving.has(collectionId)) return unorganizedFolder;
      resolving.add(collectionId);
      const segment = `${sanitizePathSegment(collection.name, "Collection")}__${collection.id.slice(0, 8)}`;
      const parentFolder = collection.parentId && collectionById.has(collection.parentId)
        ? resolveFolder(collection.parentId, resolving)
        : null;
      resolving.delete(collectionId);
      const folder = parentFolder ? `${parentFolder}/${segment}` : segment;
      folderByCollectionId.set(collectionId, folder);
      return folder;
    };
    for (const collection of [...collectionsToExport].sort(compareCollections)) {
      resolveFolder(collection.id);
    }

    type DrawingWithCollection = Prisma.DrawingGetPayload<{ include: { collection: true } }>;
    const drawingsManifest = drawings.map((drawing: DrawingWithCollection) => {
      const folder = drawing.collectionId
        ? folderByCollectionId.get(drawing.collectionId) || unorganizedFolder
        : unorganizedFolder;
      const fileNameBase = sanitizePathSegment(drawing.name, "Untitled");
      const fileName = `${fileNameBase}__${drawing.id.slice(0, 8)}.excalidraw`;
      return {
        id: drawing.id,
        name: drawing.name,
        filePath: `${folder}/${fileName}`,
        collectionId: toPublicTrashCollectionId(drawing.collectionId, req.user!.id),
        version: drawing.version,
        createdAt: drawing.createdAt.toISOString(),
        updatedAt: drawing.updatedAt.toISOString(),
      };
    });

    const manifestCollections = collectionsToExport
      .map((collection) => ({
        id: toPublicTrashCollectionId(collection.id, req.user!.id) || collection.id,
        name: isTrashCollectionId(collection.id, req.user!.id) ? "Trash" : collection.name,
        parentId: isTrashCollectionId(collection.id, req.user!.id)
          ? null
          : toPublicTrashCollectionId(collection.parentId, req.user!.id),
        folder: folderByCollectionId.get(collection.id) || sanitizePathSegment(collection.name, "Collection"),
        createdAt: collection.createdAt.toISOString(),
        updatedAt: collection.updatedAt.toISOString(),
      }))
      .filter((collection, index, all) => all.findIndex((c) => c.id === collection.id) === index)
      .sort(compareCollections);

    const manifest = {
      format: "excalidash" as const,
      formatVersion: 1 as const,
      exportedAt,
      excalidashBackendVersion: getBackendVersion(),
      userId: req.user.id,
      unorganizedFolder,
      collections: manifestCollections,
      drawings: drawingsManifest,
    };

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

    const archive = archiver("zip", { zlib: { level: 9 } });
    const abortArchive = () => {
      try {
        archive.abort();
      } catch {
      }
    };

    res.on("close", () => {
      if (res.writableEnded) return;
      abortArchive();
    });

    archive.on("error", (err) => {
      console.error("Archive error:", err);
      abortArchive();

      if (res.headersSent) {
        res.destroy(err instanceof Error ? err : undefined);
        return;
      }
      res.status(500).json({ error: "Failed to create archive" });
    });
    archive.pipe(res);

    archive.append(JSON.stringify(manifest, null, 2), { name: "excalidash.manifest.json" });

    const drawingsManifestById = new Map(drawingsManifest.map((d) => [d.id, d]));
    for (const drawing of drawings) {
      const meta = drawingsManifestById.get(drawing.id);
      if (!meta) continue;
      const drawingData = {
        type: "excalidraw" as const,
        version: 2 as const,
        source: exportSource,
        elements: parseJsonField(drawing.elements, [] as unknown[]),
        appState: parseJsonField(drawing.appState, {} as Record<string, unknown>),
        files: parseJsonField(drawing.files, {} as Record<string, unknown>),
        excalidash: {
          drawingId: drawing.id,
          collectionId: drawing.collectionId ?? null,
          exportedAt,
        },
      };
      assertSafeArchivePath(meta.filePath);
      archive.append(JSON.stringify(drawingData, null, 2), { name: meta.filePath });
    }

    const readme = `ExcaliDash Backup (.excalidash)

This file is a zip archive containing a versioned ExcaliDash manifest and your drawings,
organized into deterministic nested folders that preserve collection hierarchy.

Files:
- excalidash.manifest.json (required)
- <Collection Folder>/<Subfolder>/*.excalidraw

ExportedAt: ${exportedAt}
FormatVersion: 1
BackendVersion: ${getBackendVersion()}
Collections: ${collectionsToExport.length}
Drawings: ${drawings.length}
`;
    archive.append(readme, { name: "README.txt" });
    await archive.finalize();
  }));
};
