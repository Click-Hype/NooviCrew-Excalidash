import { describe, expect, it } from "vitest";
import {
  decorateCollectionPaths,
  getCollectionAncestorIds,
  getCollectionDescendantIds,
  validateCollectionTree,
} from "./tree";

const tree = [
  { id: "root", name: "Projects", parentId: null },
  { id: "child", name: "Client", parentId: "root" },
  { id: "leaf", name: "Planning", parentId: "child" },
];

describe("collection tree", () => {
  it("resolves ancestors, descendants and deterministic paths", () => {
    expect(getCollectionAncestorIds(tree, "leaf")).toEqual(["leaf", "child", "root"]);
    expect(new Set(getCollectionDescendantIds(tree, "root"))).toEqual(
      new Set(["root", "child", "leaf"]),
    );
    expect(decorateCollectionPaths(tree).find((node) => node.id === "leaf")).toMatchObject({
      path: "Projects / Client / Planning",
      depth: 3,
    });
  });

  it("rejects cycles, missing parents and excessive depth", () => {
    expect(
      validateCollectionTree([
        { id: "a", name: "A", parentId: "b" },
        { id: "b", name: "B", parentId: "a" },
      ]),
    ).toMatchObject({ valid: false });
    expect(
      validateCollectionTree([{ id: "a", name: "A", parentId: "missing" }]),
    ).toMatchObject({ valid: false });
    expect(validateCollectionTree(tree, 2)).toMatchObject({ valid: false });
  });
});
