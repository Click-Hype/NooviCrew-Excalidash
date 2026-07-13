import express from "express";
import { Prisma } from "../../generated/client";
import {
  canEditDrawing,
  getDrawingAccess,
  isOwnerAccess,
} from "../../authz/sharing";
import { rewritePreviewForS3 } from "../../fileProcessing";
import {
  getUserTrashCollectionId,
  toPublicTrashCollectionId,
} from "./trash";
import type { DrawingRouteContext } from "./drawingRouteContext";

export const registerDrawingUpdateRoute = (
  app: express.Express,
  context: DrawingRouteContext,
) => {
  const {
    prisma,
    optionalAuth,
    asyncHandler,
    drawingUpdateSchema,
    respondWithValidationErrors,
    ensureTrashCollection,
    invalidateDrawingsCache,
    config,
    processFilesForS3,
    parseJsonField,
    io,
    getRequestPrincipal,
    respondWithAuthErrorIfPresent,
  } = context;

  app.put(
    "/drawings/:id",
    optionalAuth,
    asyncHandler(async (req, res) => {
      const principal = await getRequestPrincipal(req);
      const { id } = req.params;
      const access = await getDrawingAccess({ prisma, principal, drawingId: id });
      if (!canEditDrawing(access)) {
        if (respondWithAuthErrorIfPresent(req, res)) return;
        return res.status(404).json({
          error: "Drawing not found",
          message: "Drawing does not exist",
        });
      }

      const existingDrawing = await prisma.drawing.findUnique({ where: { id } });
      if (!existingDrawing) {
        return res.status(404).json({ error: "Drawing not found" });
      }

      const parsed = drawingUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        if (config.nodeEnv === "development") {
          console.error("[API] Validation failed", {
            id,
            errors: parsed.error.issues,
          });
        }
        return respondWithValidationErrors(res, parsed.error.issues);
      }

      const payload = parsed.data as {
        name?: string;
        collectionId?: string | null;
        elements?: unknown[];
        appState?: Record<string, unknown>;
        preview?: string | null;
        files?: Record<string, unknown>;
        version?: number;
      };
      const ownerUserId = existingDrawing.userId;
      const trashCollectionId = getUserTrashCollectionId(ownerUserId);
      const isSceneUpdate =
        payload.elements !== undefined ||
        payload.appState !== undefined ||
        payload.files !== undefined;

      if (isSceneUpdate && payload.version === undefined) {
        return res.status(428).json({
          error: "Precondition required",
          code: "VERSION_REQUIRED",
          message:
            "Scene updates require the version returned by the latest drawing read.",
          currentVersion: existingDrawing.version,
        });
      }
      if (isSceneUpdate && payload.version !== existingDrawing.version) {
        return res.status(409).json({
          error: "Conflict",
          code: "VERSION_CONFLICT",
          message: "Drawing has changed since this editor state was loaded.",
          currentVersion: existingDrawing.version,
        });
      }

      const data: Prisma.DrawingUpdateInput = isSceneUpdate
        ? { version: { increment: 1 } }
        : {};
      if (payload.name !== undefined) data.name = payload.name;
      if (payload.elements !== undefined) {
        data.elements = JSON.stringify(payload.elements);
      }
      if (payload.appState !== undefined) {
        data.appState = JSON.stringify(payload.appState);
      }
      let processedFilesForUpdate: Record<string, unknown> | undefined;
      if (payload.files !== undefined) {
        processedFilesForUpdate = await processFilesForS3(
          payload.files,
          ownerUserId,
          id,
        );
        data.files = JSON.stringify(processedFilesForUpdate);
      }
      if (payload.preview !== undefined) {
        const processedPreview = processedFilesForUpdate
          ? rewritePreviewForS3(
              payload.preview,
              payload.files ?? {},
              processedFilesForUpdate,
            )
          : payload.preview;
        data.preview = typeof processedPreview === "string" ? processedPreview : null;
      }

      if (payload.collectionId !== undefined) {
        if (!isOwnerAccess(access)) {
          return res.status(403).json({
            error: "Forbidden",
            message: "Only the owner can move drawings between collections",
          });
        }
        if (payload.collectionId === "trash") {
          await ensureTrashCollection(prisma, ownerUserId);
          (data as Prisma.DrawingUncheckedUpdateInput).collectionId = trashCollectionId;
        } else if (payload.collectionId) {
          const collection = await prisma.collection.findFirst({
            where: { id: payload.collectionId, userId: ownerUserId },
          });
          if (!collection) {
            return res.status(404).json({ error: "Collection not found" });
          }
          (data as Prisma.DrawingUncheckedUpdateInput).collectionId =
            payload.collectionId;
        } else {
          (data as Prisma.DrawingUncheckedUpdateInput).collectionId = null;
        }
      }

      const updateWhere: Prisma.DrawingWhereInput = { id };
      if (isSceneUpdate && payload.version !== undefined) {
        updateWhere.version = payload.version;
      }
      const versionConflictError = new Error("VERSION_CONFLICT");
      let updatedDrawing: typeof existingDrawing | null = null;

      try {
        if (isSceneUpdate) {
          updatedDrawing = await prisma.$transaction(async (tx) => {
            await tx.drawingSnapshot.create({
              data: {
                drawingId: id,
                version: existingDrawing.version,
                elements: existingDrawing.elements,
                appState: existingDrawing.appState,
                files: existingDrawing.files,
              },
            });
            const updateResult = await tx.drawing.updateMany({
              where: updateWhere,
              data,
            });
            if (updateResult.count === 0) throw versionConflictError;
            return tx.drawing.findFirst({ where: { id } });
          });
        } else {
          const updateResult = await prisma.drawing.updateMany({
            where: updateWhere,
            data,
          });
          if (updateResult.count === 0) {
            return res.status(404).json({ error: "Drawing not found" });
          }
          updatedDrawing = await prisma.drawing.findFirst({ where: { id } });
        }
      } catch (error) {
        if (
          error === versionConflictError ||
          (error instanceof Error && error.message === versionConflictError.message)
        ) {
          const latestDrawing = await prisma.drawing.findFirst({
            where: { id },
            select: { version: true },
          });
          if (isSceneUpdate && payload.version !== undefined) {
            return res.status(409).json({
              error: "Conflict",
              code: "VERSION_CONFLICT",
              message: "Drawing has changed since this editor state was loaded.",
              currentVersion: latestDrawing?.version ?? null,
            });
          }
        }
        throw error;
      }
      if (!updatedDrawing) {
        return res.status(404).json({ error: "Drawing not found" });
      }

      invalidateDrawingsCache();
      if (req.user?.authCredentialType === "apiKey" && isSceneUpdate) {
        io.to(`drawing_${id}`).emit("drawing-server-update", {
          drawingId: id,
          version: updatedDrawing.version,
          updatedAt: updatedDrawing.updatedAt,
          source: "apiKey",
        });
      }
      return res.json({
        ...updatedDrawing,
        collectionId: toPublicTrashCollectionId(
          updatedDrawing.collectionId,
          ownerUserId,
        ),
        elements: parseJsonField(updatedDrawing.elements, []),
        appState: parseJsonField(updatedDrawing.appState, {}),
        files: parseJsonField(updatedDrawing.files, {}),
        accessLevel: access,
      });
    }),
  );
};
