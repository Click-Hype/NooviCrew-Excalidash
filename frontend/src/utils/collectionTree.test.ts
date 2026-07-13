import { describe, expect, it } from "vitest";
import type { Collection } from "../types";
import { flattenCollectionTree, getCollectionSubtreeIds } from "./collectionTree";

const makeCollection = (
  id: string,
  name: string,
  parentId: string | null = null,
): Collection => ({ id, name, parentId, createdAt: 0 });

describe("collectionTree", () => {
  it("flattens folders in stable hierarchical order with unambiguous paths", () => {
    const result = flattenCollectionTree([
      makeCollection("z", "Zulu"),
      makeCollection("child", "Planning", "a"),
      makeCollection("a", "Alpha"),
      makeCollection("leaf", "Week 1", "child"),
    ]);

    expect(result.map((collection) => collection.id)).toEqual([
      "a",
      "child",
      "leaf",
      "z",
    ]);
    expect(result.find((collection) => collection.id === "leaf")).toMatchObject({
      depth: 2,
      path: "Alpha / Planning / Week 1",
    });
  });

  it("returns the complete subtree and keeps corrupt nodes recoverable", () => {
    const collections = [
      makeCollection("root", "Root"),
      makeCollection("child", "Child", "root"),
      makeCollection("a", "Cycle A", "b"),
      makeCollection("b", "Cycle B", "a"),
    ];
    expect(getCollectionSubtreeIds(collections, "root")).toEqual(
      new Set(["root", "child"]),
    );
    expect(flattenCollectionTree(collections).map((collection) => collection.id)).toEqual(
      expect.arrayContaining(["root", "child", "a", "b"]),
    );
  });
});
