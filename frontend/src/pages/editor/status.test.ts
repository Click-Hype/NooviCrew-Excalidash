import { describe, expect, it } from "vitest";
import { canReloadForServerUpdate, type EditorSaveState } from "./status";

describe("canReloadForServerUpdate", () => {
  it("reloads only when there is no local work to protect", () => {
    expect(canReloadForServerUpdate("saved")).toBe(true);

    for (const state of [
      "dirty",
      "saving",
      "error",
      "conflict",
    ] satisfies EditorSaveState[]) {
      expect(canReloadForServerUpdate(state)).toBe(false);
    }
  });
});
