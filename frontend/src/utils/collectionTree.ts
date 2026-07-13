import type { Collection } from "../types";

export type CollectionTreeOption = Collection & {
  depth: number;
  path: string;
};

const compareCollections = (left: Collection, right: Collection): number =>
  left.name.localeCompare(right.name, "en", { sensitivity: "base" }) ||
  left.id.localeCompare(right.id, "en");

export const flattenCollectionTree = (
  collections: Collection[],
): CollectionTreeOption[] => {
  const byId = new Map(collections.map((collection) => [collection.id, collection]));
  const childrenByParent = new Map<string | null, Collection[]>();
  for (const collection of collections) {
    const parentId = collection.parentId && byId.has(collection.parentId)
      ? collection.parentId
      : null;
    const siblings = childrenByParent.get(parentId) ?? [];
    siblings.push(collection);
    childrenByParent.set(parentId, siblings);
  }
  for (const siblings of childrenByParent.values()) siblings.sort(compareCollections);

  const result: CollectionTreeOption[] = [];
  const visited = new Set<string>();
  const append = (collection: Collection, depth: number, parentPath: string) => {
    if (visited.has(collection.id)) return;
    visited.add(collection.id);
    const path = parentPath ? `${parentPath} / ${collection.name}` : collection.name;
    result.push({ ...collection, depth, path });
    for (const child of childrenByParent.get(collection.id) ?? []) {
      append(child, depth + 1, path);
    }
  };
  for (const root of childrenByParent.get(null) ?? []) append(root, 0, "");

  // Corrupt cycles should not hide folders from recovery UI.
  for (const collection of [...collections].sort(compareCollections)) {
    if (!visited.has(collection.id)) append(collection, 0, "");
  }
  return result;
};

export const getCollectionSubtreeIds = (
  collections: Collection[],
  rootId: string,
): Set<string> => {
  const result = new Set<string>();
  const pending = [rootId];
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (result.has(current)) continue;
    result.add(current);
    for (const collection of collections) {
      if (collection.parentId === current) pending.push(collection.id);
    }
  }
  return result;
};
