import express from "express";
import { DashboardRouteDeps } from "./types";
import { getUserTrashCollectionId, isTrashCollectionId } from "./trash";
import {
  decorateCollectionPaths,
  getCollectionAncestorIds,
} from "../../collections/tree";
import { registerCollectionSharingRoutes } from "./collectionSharingRoutes";
import {
  createOwnedCollectionInTree,
  deleteOwnedCollectionTree,
  updateOwnedCollectionInTree,
} from "../../collections/mutations";

const shareRoleRank = (role: string): number => (role === "edit" ? 2 : role === "view" ? 1 : 0);

export const registerCollectionRoutes = (
  app: express.Express,
  deps: DashboardRouteDeps,
) => {
  const {
    prisma,
    requireAuth,
    asyncHandler,
    collectionNameSchema,
    sanitizeText,
    ensureTrashCollection,
    invalidateDrawingsCache,
    config,
    logAuditEvent,
  } = deps;

  // GET /collections — returns owned collections + collections shared with user
  app.get(
    "/collections",
    requireAuth,
    asyncHandler(async (req, res) => {
      if (!req.user) return res.status(401).json({ error: "Unauthorized" });
      const trashCollectionId = getUserTrashCollectionId(req.user.id);
      await ensureTrashCollection(prisma, req.user.id);

      const rawCollections = await prisma.collection.findMany({
        where: { userId: req.user.id },
      });
      const hasInternalTrash = rawCollections.some(
        (c) => c.id === trashCollectionId,
      );
      const shareCountMap = await prisma.collectionShare.groupBy({
        by: ["collectionId"],
        where: {
          collectionId: {
            in: rawCollections.map((c) => c.id),
          },
        },
        _count: { collectionId: true },
      });
      const sharedCollectionIds = new Set(
        shareCountMap.map((s) => s.collectionId),
      );

      const ownedCollections = rawCollections
        .filter((c) => !(hasInternalTrash && c.id === "trash"))
        .map((c) =>
          c.id === trashCollectionId
            ? {
                ...c,
                id: "trash",
                name: "Trash",
                sharedRole: null,
                isOwner: true,
                isShared: false,
              }
            : {
                ...c,
                sharedRole: null,
                isOwner: true,
                isShared: getCollectionAncestorIds(rawCollections, c.id).some(
                  (ancestorId) => sharedCollectionIds.has(ancestorId),
                ),
              },
        );

      // A share on a collection applies to its complete descendant subtree.
      // Overlapping shares use the strongest role, so a child share can elevate
      // inherited access but cannot unexpectedly remove it.
      const sharedEntries = await prisma.collectionShare.findMany({
        where: { granteeUserId: req.user.id },
        include: {
          collection: {
            include: {
              user: { select: { id: true, name: true, email: true } },
            },
          },
        },
      });
      const sharedOwnerIds = [
        ...new Set(sharedEntries.map((entry) => entry.collection.userId)),
      ];
      const sharedOwnerCollections = sharedOwnerIds.length
        ? await prisma.collection.findMany({
            where: { userId: { in: sharedOwnerIds } },
            include: { user: { select: { id: true, name: true, email: true } } },
          })
        : [];
      const sharesByCollectionId = new Map(
        sharedEntries.map((entry) => [entry.collectionId, entry]),
      );
      const accessibleShared = sharedOwnerCollections.flatMap((collection) => {
        const ownerTree = sharedOwnerCollections.filter(
          (candidate) => candidate.userId === collection.userId,
        );
        const ancestorIds = getCollectionAncestorIds(ownerTree, collection.id);
        const applicableShares = ancestorIds
          .map((ancestorId) => sharesByCollectionId.get(ancestorId))
          .filter((entry): entry is (typeof sharedEntries)[number] => Boolean(entry));
        if (applicableShares.length === 0) return [];
        const effectiveShare = applicableShares.sort(
          (left, right) => shareRoleRank(right.role) - shareRoleRank(left.role),
        )[0];
        return [{
          ...collection,
          sharedRole: effectiveShare.role,
          shareSourceCollectionId: effectiveShare.collectionId,
          sharedViaAncestor: effectiveShare.collectionId !== collection.id,
          isOwner: false,
          isShared: true,
        }];
      });
      const accessibleSharedIds = new Set(accessibleShared.map((collection) => collection.id));
      const normalizedShared = accessibleShared.map((collection) => ({
        ...collection,
        parentId:
          collection.parentId && accessibleSharedIds.has(collection.parentId)
            ? collection.parentId
            : null,
      }));

      return res.json(
        decorateCollectionPaths([
          ...ownedCollections.map((collection) => ({ ...collection, parentId: collection.parentId ?? null })),
          ...normalizedShared,
        ]),
      );
    }),
  );

  // POST /collections
  app.post(
    "/collections",
    requireAuth,
    asyncHandler(async (req, res) => {
      if (!req.user) return res.status(401).json({ error: "Unauthorized" });

      const parsed = collectionNameSchema.safeParse(req.body.name);
      if (!parsed.success) {
        return res.status(400).json({
          error: "Validation error",
          message: "Collection name must be between 1 and 100 characters",
        });
      }

      const sanitizedName = sanitizeText(parsed.data, 100);

      // parentId is optional and must remain inside the owner's valid tree.
      let parentId: string | null = null;
      if (req.body.parentId !== undefined && req.body.parentId !== null) {
        parentId = String(req.body.parentId);
        if (parentId === "trash") {
          return res.status(400).json({ error: "Validation error", message: "Cannot nest under Trash" });
        }
        const parent = await prisma.collection.findFirst({ where: { id: parentId, userId: req.user.id } });
        if (!parent) {
          return res.status(400).json({ error: "Validation error", message: "Parent folder not found" });
        }
      }

      const result = await createOwnedCollectionInTree({
        prisma,
        userId: req.user.id,
        name: sanitizedName,
        parentId,
      });
      if ("failure" in result) {
        return res.status(result.failure.status).json(result.failure);
      }
      const decorated = decorateCollectionPaths([...result.previousTree, result.collection]).find(
        (collection) => collection.id === result.collection.id,
      );
      return res.json({ ...decorated, sharedRole: null, isOwner: true, isShared: false });
    }),
  );

  // PUT /collections/:id — owner only
  app.put(
    "/collections/:id",
    requireAuth,
    asyncHandler(async (req, res) => {
      if (!req.user) return res.status(401).json({ error: "Unauthorized" });

      const { id } = req.params;
      if (isTrashCollectionId(id, req.user.id)) {
        return res.status(400).json({
          error: "Validation error",
          message: "Trash collection cannot be renamed",
        });
      }
      const existing = await prisma.collection.findFirst({
        where: { id, userId: req.user.id },
      });
      if (!existing)
        return res.status(404).json({ error: "Collection not found" });

      const wantsName = req.body.name !== undefined;
      const wantsParent = req.body.parentId !== undefined;
      if (!wantsName && !wantsParent) {
        return res.status(400).json({ error: "Validation error", message: "Nothing to update" });
      }

      const data: { name?: string; parentId?: string | null } = {};
      if (wantsName) {
        const parsed = collectionNameSchema.safeParse(req.body.name);
        if (!parsed.success) {
          return res.status(400).json({
            error: "Validation error",
            message: "Collection name must be between 1 and 100 characters",
          });
        }
        data.name = sanitizeText(parsed.data, 100);
      }
      if (wantsParent) {
        const newParentId = req.body.parentId === null ? null : String(req.body.parentId);
        if (newParentId) {
          if (newParentId === id) {
            return res.status(400).json({ error: "Validation error", message: "Cannot nest a folder inside itself" });
          }
          if (newParentId === "trash") {
            return res.status(400).json({ error: "Validation error", message: "Cannot nest under Trash" });
          }
          const parent = await prisma.collection.findFirst({ where: { id: newParentId, userId: req.user.id } });
          if (!parent) {
            return res.status(400).json({ error: "Validation error", message: "Parent folder not found" });
          }
        }
        data.parentId = newParentId;
      }

      const result = await updateOwnedCollectionInTree({
        prisma,
        userId: req.user.id,
        id,
        data,
      });
      if ("failure" in result) {
        return res.status(result.failure.status).json(result.failure);
      }
      const decorated = decorateCollectionPaths(
        result.previousTree.map((collection) =>
          collection.id === id ? { ...collection, ...result.collection } : collection,
        ),
      ).find((collection) => collection.id === id);
      return res.json(decorated ?? result.collection);
    }),
  );

  // DELETE /collections/:id — owner only
  app.delete(
    "/collections/:id",
    requireAuth,
    asyncHandler(async (req, res) => {
      if (!req.user) return res.status(401).json({ error: "Unauthorized" });

      const { id } = req.params;
      if (isTrashCollectionId(id, req.user.id)) {
        return res.status(400).json({
          error: "Validation error",
          message: "Trash collection cannot be deleted",
        });
      }
      const result = await deleteOwnedCollectionTree({
        prisma,
        userId: req.user.id,
        id,
      });
      if (!result) return res.status(404).json({ error: "Collection not found" });
      invalidateDrawingsCache();

      if (config.enableAuditLogging) {
        await logAuditEvent({
          userId: req.user.id,
          action: "collection_deleted",
          resource: `collection:${id}`,
          ipAddress: req.ip || req.connection.remoteAddress || undefined,
          userAgent: req.headers["user-agent"] || undefined,
          details: {
            collectionId: id,
            collectionName: result.collection.name,
            deletedCollectionIds: result.deletedCollectionIds,
            movedDrawings: result.movedDrawings,
          },
        });
      }

      return res.json({
        success: true,
        deletedCollections: result.deletedCollectionIds.length,
        movedDrawings: result.movedDrawings,
      });
    }),
  );

  registerCollectionSharingRoutes(app, deps);
};
