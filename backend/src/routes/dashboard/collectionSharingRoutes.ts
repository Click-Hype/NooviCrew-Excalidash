import express from "express";
import type { DashboardRouteDeps } from "./types";
import { isTrashCollectionId } from "./trash";

export const registerCollectionSharingRoutes = (
  app: express.Express,
  deps: DashboardRouteDeps,
) => {
  const { prisma, requireAuth, asyncHandler, invalidateDrawingsCache } = deps;

  app.get(
    "/collections/:id/shares",
    requireAuth,
    asyncHandler(async (req, res) => {
      if (!req.user) return res.status(401).json({ error: "Unauthorized" });
      const { id } = req.params;
      if (isTrashCollectionId(id, req.user.id)) {
        return res.status(400).json({ error: "Trash cannot be shared" });
      }
      const collection = await prisma.collection.findFirst({
        where: { id, userId: req.user.id },
      });
      if (!collection) return res.status(404).json({ error: "Collection not found" });

      const shares = await prisma.collectionShare.findMany({
        where: { collectionId: id },
        include: {
          granteeUser: { select: { id: true, name: true, email: true } },
        },
        orderBy: { createdAt: "asc" },
      });
      return res.json({ shares });
    }),
  );

  app.post(
    "/collections/:id/shares",
    requireAuth,
    asyncHandler(async (req, res) => {
      if (!req.user) return res.status(401).json({ error: "Unauthorized" });
      const { id } = req.params;
      if (isTrashCollectionId(id, req.user.id)) {
        return res.status(400).json({ error: "Trash cannot be shared" });
      }
      const { identifier, role } = req.body as { identifier: string; role: string };
      if (!identifier || !["view", "edit"].includes(role)) {
        return res.status(400).json({
          error: "identifier and role (view|edit) are required",
        });
      }

      const collection = await prisma.collection.findFirst({
        where: { id, userId: req.user.id },
      });
      if (!collection) return res.status(404).json({ error: "Collection not found" });

      const grantee = await prisma.user.findFirst({
        where: {
          isActive: true,
          OR: [
            { email: identifier.toLowerCase() },
            { username: identifier },
            { name: identifier },
          ],
        },
        select: { id: true, name: true, email: true },
      });
      if (!grantee) return res.status(404).json({ error: "User not found" });
      if (grantee.id === req.user.id) {
        return res.status(400).json({ error: "Cannot share with yourself" });
      }

      const share = await prisma.collectionShare.upsert({
        where: {
          collectionId_granteeUserId: {
            collectionId: id,
            granteeUserId: grantee.id,
          },
        },
        update: { role, updatedAt: new Date() },
        create: {
          collectionId: id,
          granteeUserId: grantee.id,
          role,
          createdByUserId: req.user.id,
        },
        include: {
          granteeUser: { select: { id: true, name: true, email: true } },
        },
      });
      invalidateDrawingsCache();
      return res.json({ share });
    }),
  );

  app.patch(
    "/collections/:id/shares/:userId",
    requireAuth,
    asyncHandler(async (req, res) => {
      if (!req.user) return res.status(401).json({ error: "Unauthorized" });
      const { id, userId } = req.params;
      if (isTrashCollectionId(id, req.user.id)) {
        return res.status(400).json({ error: "Trash cannot be shared" });
      }
      const { role } = req.body as { role: string };
      if (!["view", "edit"].includes(role)) {
        return res.status(400).json({ error: "role must be view or edit" });
      }
      const collection = await prisma.collection.findFirst({
        where: { id, userId: req.user.id },
      });
      if (!collection) return res.status(404).json({ error: "Collection not found" });

      const share = await prisma.collectionShare.updateMany({
        where: { collectionId: id, granteeUserId: userId },
        data: { role, updatedAt: new Date() },
      });
      if (share.count === 0) return res.status(404).json({ error: "Share not found" });
      invalidateDrawingsCache();
      return res.json({ success: true });
    }),
  );

  app.delete(
    "/collections/:id/shares/:userId",
    requireAuth,
    asyncHandler(async (req, res) => {
      if (!req.user) return res.status(401).json({ error: "Unauthorized" });
      const { id, userId } = req.params;
      if (isTrashCollectionId(id, req.user.id)) {
        return res.status(400).json({ error: "Trash cannot be shared" });
      }
      const collection = await prisma.collection.findFirst({
        where: { id, userId: req.user.id },
      });
      if (!collection) return res.status(404).json({ error: "Collection not found" });
      await prisma.collectionShare.deleteMany({
        where: { collectionId: id, granteeUserId: userId },
      });
      invalidateDrawingsCache();
      return res.json({ success: true });
    }),
  );

  app.get(
    "/collections/:id/share-resolve",
    requireAuth,
    asyncHandler(async (req, res) => {
      if (!req.user) return res.status(401).json({ error: "Unauthorized" });
      const { id } = req.params;
      if (isTrashCollectionId(id, req.user.id)) {
        return res.status(400).json({ error: "Trash cannot be shared" });
      }
      const q = String(req.query.q || "").trim();
      if (q.length < 2) return res.json({ users: [] });

      const collection = await prisma.collection.findFirst({
        where: { id, userId: req.user.id },
      });
      if (!collection) return res.status(404).json({ error: "Collection not found" });
      const existing = await prisma.collectionShare.findMany({
        where: { collectionId: id },
        select: { granteeUserId: true },
      });
      const excludeIds = [req.user.id, ...existing.map((share) => share.granteeUserId)];
      const users = await prisma.user.findMany({
        where: {
          isActive: true,
          id: { notIn: excludeIds },
          OR: [
            { email: { contains: q } },
            { name: { contains: q } },
            { username: { contains: q } },
          ],
        },
        select: { id: true, name: true, email: true },
        take: 8,
      });
      return res.json({ users });
    }),
  );
};
