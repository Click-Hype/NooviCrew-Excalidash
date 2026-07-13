import type { PrismaClient } from "../generated/client";

export const MAX_COLLECTION_DEPTH = 20;

export type CollectionTreeNode = {
  id: string;
  name: string;
  parentId: string | null;
};

export type CollectionTreeValidation =
  | { valid: true; depthById: Map<string, number> }
  | { valid: false; message: string };

const compareText = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

export const compareCollections = (
  left: Pick<CollectionTreeNode, "id" | "name">,
  right: Pick<CollectionTreeNode, "id" | "name">,
): number => {
  const byName = compareText(left.name.toLocaleLowerCase("en-US"), right.name.toLocaleLowerCase("en-US"));
  if (byName !== 0) return byName;
  return compareText(left.id, right.id);
};

export const validateCollectionTree = (
  nodes: CollectionTreeNode[],
  maxDepth = MAX_COLLECTION_DEPTH,
): CollectionTreeValidation => {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const depthById = new Map<string, number>();
  const visiting = new Set<string>();

  const visit = (id: string): number | string => {
    const knownDepth = depthById.get(id);
    if (knownDepth !== undefined) return knownDepth;
    if (visiting.has(id)) return `Collection tree contains a cycle at ${id}`;

    const node = byId.get(id);
    if (!node) return `Collection not found: ${id}`;
    visiting.add(id);

    let depth = 1;
    if (node.parentId) {
      if (!byId.has(node.parentId)) {
        visiting.delete(id);
        return `Parent collection not found: ${node.parentId}`;
      }
      const parentDepth = visit(node.parentId);
      if (typeof parentDepth === "string") {
        visiting.delete(id);
        return parentDepth;
      }
      depth = parentDepth + 1;
    }

    visiting.delete(id);
    if (depth > maxDepth) {
      return `Collection tree exceeds the maximum depth of ${maxDepth}`;
    }
    depthById.set(id, depth);
    return depth;
  };

  for (const node of nodes) {
    const result = visit(node.id);
    if (typeof result === "string") return { valid: false, message: result };
  }
  return { valid: true, depthById };
};

export const getCollectionDescendantIds = (
  nodes: CollectionTreeNode[],
  rootId: string,
): string[] => {
  const childrenByParent = new Map<string, string[]>();
  for (const node of nodes) {
    if (!node.parentId) continue;
    const children = childrenByParent.get(node.parentId) ?? [];
    children.push(node.id);
    childrenByParent.set(node.parentId, children);
  }

  const result: string[] = [];
  const seen = new Set<string>();
  const pending = [rootId];
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (seen.has(current)) continue;
    seen.add(current);
    result.push(current);
    for (const child of childrenByParent.get(current) ?? []) pending.push(child);
  }
  return result;
};

export const getCollectionAncestorIds = (
  nodes: CollectionTreeNode[],
  collectionId: string,
): string[] => {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const result: string[] = [];
  const seen = new Set<string>();
  let cursor: string | null = collectionId;
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    result.push(cursor);
    cursor = byId.get(cursor)?.parentId ?? null;
  }
  return result;
};

export const decorateCollectionPaths = <T extends CollectionTreeNode>(
  nodes: T[],
): Array<T & { path: string; depth: number }> => {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const cache = new Map<string, { path: string; depth: number }>();

  const resolve = (node: T): { path: string; depth: number } => {
    const cached = cache.get(node.id);
    if (cached) return cached;
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    const value = parent
      ? (() => {
          const parentValue = resolve(parent);
          return { path: `${parentValue.path} / ${node.name}`, depth: parentValue.depth + 1 };
        })()
      : { path: node.name, depth: 1 };
    cache.set(node.id, value);
    return value;
  };

  return nodes
    .map((node) => ({ ...node, ...resolve(node) }))
    .sort((left, right) => compareText(left.path.toLocaleLowerCase("en-US"), right.path.toLocaleLowerCase("en-US")) || compareText(left.id, right.id));
};

export type EffectiveCollectionAccess = {
  role: "owner" | "edit" | "view";
  sourceCollectionId: string;
  inherited: boolean;
};

const roleRank = (role: "edit" | "view"): number => (role === "edit" ? 2 : 1);

export const getEffectiveCollectionAccess = async (params: {
  prisma: PrismaClient;
  collectionId: string;
  userId: string;
}): Promise<EffectiveCollectionAccess | null> => {
  const collection = await params.prisma.collection.findUnique({
    where: { id: params.collectionId },
    select: { id: true, userId: true },
  });
  if (!collection) return null;
  if (collection.userId === params.userId) {
    return { role: "owner", sourceCollectionId: collection.id, inherited: false };
  }

  const ownerCollections = await params.prisma.collection.findMany({
    where: { userId: collection.userId },
    select: { id: true, name: true, parentId: true },
  });
  const ancestorIds = getCollectionAncestorIds(ownerCollections, collection.id);
  const shares = await params.prisma.collectionShare.findMany({
    where: {
      granteeUserId: params.userId,
      collectionId: { in: ancestorIds },
    },
    select: { collectionId: true, role: true },
  });

  let effective: { collectionId: string; role: "edit" | "view" } | null = null;
  for (const share of shares) {
    if (share.role !== "edit" && share.role !== "view") continue;
    if (!effective || roleRank(share.role) > roleRank(effective.role)) {
      effective = { collectionId: share.collectionId, role: share.role };
    }
  }
  if (!effective) return null;
  return {
    role: effective.role,
    sourceCollectionId: effective.collectionId,
    inherited: effective.collectionId !== collection.id,
  };
};

export const getSharedCollectionIds = async (params: {
  prisma: PrismaClient;
  userId: string;
}): Promise<string[]> => {
  const shares = await params.prisma.collectionShare.findMany({
    where: { granteeUserId: params.userId },
    select: { collectionId: true, collection: { select: { userId: true } } },
  });
  const ownerIds = [...new Set(shares.map((share) => share.collection.userId))];
  if (ownerIds.length === 0) return [];
  const collections = await params.prisma.collection.findMany({
    where: { userId: { in: ownerIds } },
    select: { id: true, name: true, parentId: true, userId: true },
  });
  const sharedRoots = new Set(shares.map((share) => share.collectionId));
  return collections
    .filter((collection) =>
      getCollectionAncestorIds(collections, collection.id).some((id) => sharedRoots.has(id)),
    )
    .map((collection) => collection.id);
};
