import { Prisma, type PrismaClient } from "../generated/client";
import {
  MAX_COLLECTION_DEPTH,
  getCollectionDescendantIds,
  validateCollectionTree,
} from "./tree";

type MutationError = { status: 400 | 404 | 409; error: string; message: string };

const normalizeName = (name: string): string =>
  name.trim().normalize("NFKC").toLocaleLowerCase("en-US");

const isTrashId = (id: string, userId: string): boolean =>
  id === "trash" || id === `trash:${userId}`;

const duplicateSiblingError = (): MutationError => ({
  status: 409,
  error: "Collection already exists",
  message: "Folder names must be unique within the same parent",
});

export const createOwnedCollectionInTree = (params: {
  prisma: PrismaClient;
  userId: string;
  name: string;
  parentId: string | null;
}) =>
  params.prisma.$transaction(
    async (tx) => {
      const currentTree = await tx.collection.findMany({
        where: { userId: params.userId },
        select: { id: true, name: true, parentId: true },
      });
      if (
        currentTree.some(
          (collection) =>
            collection.parentId === params.parentId &&
            normalizeName(collection.name) === normalizeName(params.name),
        )
      ) {
        return { failure: duplicateSiblingError() };
      }

      const validation = validateCollectionTree([
        ...currentTree.filter((collection) => !isTrashId(collection.id, params.userId)),
        { id: `new:${params.userId}`, name: params.name, parentId: params.parentId },
      ]);
      if ("message" in validation) {
        return {
          failure: { status: 400, error: "Validation error", message: validation.message } as MutationError,
        };
      }
      const collection = await tx.collection.create({
        data: {
          name: params.name,
          userId: params.userId,
          parentId: params.parentId,
        },
      });
      return { collection, previousTree: currentTree };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );

export const updateOwnedCollectionInTree = (params: {
  prisma: PrismaClient;
  userId: string;
  id: string;
  data: { name?: string; parentId?: string | null };
}) =>
  params.prisma.$transaction(
    async (tx) => {
      const currentTree = await tx.collection.findMany({
        where: { userId: params.userId },
        select: { id: true, name: true, parentId: true },
      });
      if (!currentTree.some((collection) => collection.id === params.id)) {
        return {
          failure: {
            status: 404,
            error: "Collection not found",
            message: "Collection not found",
          } as MutationError,
        };
      }
      const prospectiveTree = currentTree
        .filter((collection) => !isTrashId(collection.id, params.userId))
        .map((collection) =>
          collection.id === params.id
            ? {
                ...collection,
                name: params.data.name ?? collection.name,
                parentId:
                  params.data.parentId === undefined
                    ? collection.parentId
                    : params.data.parentId,
              }
            : collection,
        );
      const changed = prospectiveTree.find((collection) => collection.id === params.id)!;
      if (
        prospectiveTree.some(
          (collection) =>
            collection.id !== params.id &&
            collection.parentId === changed.parentId &&
            normalizeName(collection.name) === normalizeName(changed.name),
        )
      ) {
        return { failure: duplicateSiblingError() };
      }
      const validation = validateCollectionTree(prospectiveTree, MAX_COLLECTION_DEPTH);
      if ("message" in validation) {
        return {
          failure: { status: 400, error: "Validation error", message: validation.message } as MutationError,
        };
      }
      const collection = await tx.collection.update({
        where: { id: params.id },
        data: params.data,
      });
      return { collection, previousTree: currentTree };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );

export const deleteOwnedCollectionTree = (params: {
  prisma: PrismaClient;
  userId: string;
  id: string;
}) =>
  params.prisma.$transaction(
    async (tx) => {
      const collection = await tx.collection.findFirst({
        where: { id: params.id, userId: params.userId },
      });
      if (!collection) return null;
      const ownerTree = await tx.collection.findMany({
        where: { userId: params.userId },
        select: { id: true, name: true, parentId: true },
      });
      const subtreeIds = getCollectionDescendantIds(ownerTree, params.id);
      const movedDrawings = await tx.drawing.updateMany({
        where: { collectionId: { in: subtreeIds } },
        data: { collectionId: null },
      });
      await tx.collectionShare.deleteMany({
        where: { collectionId: { in: subtreeIds } },
      });
      // Preserve any legacy/corrupt cross-owner child instead of allowing the
      // self-relation's ON DELETE CASCADE to remove another user's data.
      await tx.collection.updateMany({
        where: {
          parentId: { in: subtreeIds },
          userId: { not: params.userId },
        },
        data: { parentId: null },
      });
      await tx.collection.deleteMany({
        where: { id: { in: subtreeIds }, userId: params.userId },
      });
      return {
        collection,
        deletedCollectionIds: subtreeIds,
        movedDrawings: movedDrawings.count,
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
