import express from "express";
import { v4 as uuidv4, v5 as uuidv5 } from "uuid";
import { rewritePreviewForS3 } from "../../fileProcessing";
import { getEffectiveCollectionAccess } from "../../collections/tree";
import {
  isTrashCollectionId,
  toInternalTrashCollectionId,
  toPublicTrashCollectionId,
} from "./trash";
import type { DrawingRouteContext } from "./drawingRouteContext";

export const registerDrawingCreateRoute = (
  app: express.Express,
  context: DrawingRouteContext,
) => {
  const {
    prisma,
    requireAuth,
    asyncHandler,
    validateImportedDrawing,
    drawingCreateSchema,
    respondWithValidationErrors,
    ensureTrashCollection,
    invalidateDrawingsCache,
    processFilesForS3,
    parseJsonField,
  } = context;

  app.post(
    "/drawings",
    requireAuth,
    asyncHandler(async (req, res) => {
      if (!req.user) return res.status(401).json({ error: "Unauthorized" });

      const isImportedDrawing = req.headers["x-imported-file"] === "true";
      if (isImportedDrawing && !validateImportedDrawing(req.body)) {
        return res.status(400).json({
          error: "Invalid imported drawing file",
          message:
            "The imported file contains potentially malicious content or invalid structure",
        });
      }

      const parsed = drawingCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        return respondWithValidationErrors(res, parsed.error.issues);
      }

      const payload = parsed.data as {
        name?: string;
        collectionId?: string | null;
        elements: unknown[];
        appState: Record<string, unknown>;
        preview?: string | null;
        files?: Record<string, unknown>;
      };
      const drawingName = payload.name ?? "Untitled Drawing";
      const targetCollectionIdRaw =
        payload.collectionId === undefined ? null : payload.collectionId;
      const targetCollectionId =
        toInternalTrashCollectionId(targetCollectionIdRaw, req.user.id) ?? null;

      if (
        targetCollectionId &&
        !isTrashCollectionId(targetCollectionId, req.user.id)
      ) {
        const collection = await prisma.collection.findFirst({
          where: { id: targetCollectionId },
        });
        if (!collection) {
          return res.status(404).json({ error: "Collection not found" });
        }
        if (collection.userId !== req.user.id) {
          const collectionAccess = await getEffectiveCollectionAccess({
            prisma,
            collectionId: targetCollectionId,
            userId: req.user.id,
          });
          if (collectionAccess?.role !== "edit") {
            return res
              .status(403)
              .json({ error: "No edit access to this collection" });
          }
        }
      } else if (targetCollectionIdRaw === "trash") {
        await ensureTrashCollection(prisma, req.user.id);
      }

      const idempotencyKey = req.header("Idempotency-Key")?.trim();
      if (
        idempotencyKey &&
        (idempotencyKey.length < 8 ||
          idempotencyKey.length > 200 ||
          !/^[\x21-\x7e]+$/.test(idempotencyKey))
      ) {
        return res.status(400).json({
          error: "Invalid Idempotency-Key",
          message:
            "Idempotency-Key must contain 8-200 visible ASCII characters without spaces.",
        });
      }

      const newDrawingId = idempotencyKey
        ? uuidv5(`${req.user.id}:${idempotencyKey}`, uuidv5.URL)
        : uuidv4();
      if (idempotencyKey) {
        const replayedDrawing = await prisma.drawing.findFirst({
          where: { id: newDrawingId, userId: req.user.id },
        });
        if (replayedDrawing) {
          res.setHeader("Idempotency-Replayed", "true");
          return res.json({
            ...replayedDrawing,
            collectionId: toPublicTrashCollectionId(
              replayedDrawing.collectionId,
              req.user.id,
            ),
            elements: parseJsonField(replayedDrawing.elements, []),
            appState: parseJsonField(replayedDrawing.appState, {}),
            files: parseJsonField(replayedDrawing.files, {}),
          });
        }
      }

      const originalFiles = payload.files ?? {};
      const processedFiles = await processFilesForS3(
        originalFiles,
        req.user.id,
        newDrawingId,
      );
      const processedPreview = rewritePreviewForS3(
        payload.preview ?? null,
        originalFiles,
        processedFiles,
      );

      let newDrawing;
      try {
        newDrawing = await prisma.drawing.create({
          data: {
            id: newDrawingId,
            name: drawingName,
            elements: JSON.stringify(payload.elements),
            appState: JSON.stringify(payload.appState),
            userId: req.user.id,
            collectionId: targetCollectionId,
            preview:
              typeof processedPreview === "string" ? processedPreview : null,
            files: JSON.stringify(processedFiles),
          },
        });
      } catch (error) {
        const prismaCode = (error as { code?: string }).code;
        if (!idempotencyKey || prismaCode !== "P2002") throw error;
        newDrawing = await prisma.drawing.findFirst({
          where: { id: newDrawingId, userId: req.user.id },
        });
        if (!newDrawing) throw error;
        res.setHeader("Idempotency-Replayed", "true");
      }
      invalidateDrawingsCache();
      if (idempotencyKey && !res.hasHeader("Idempotency-Replayed")) {
        res.setHeader("Idempotency-Replayed", "false");
      }

      return res.json({
        ...newDrawing,
        collectionId: toPublicTrashCollectionId(
          newDrawing.collectionId,
          req.user.id,
        ),
        elements: parseJsonField(newDrawing.elements, []),
        appState: parseJsonField(newDrawing.appState, {}),
        files: parseJsonField(newDrawing.files, {}),
      });
    }),
  );
};
