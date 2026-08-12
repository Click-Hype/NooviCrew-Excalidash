import { describe, expect, it, vi } from "vitest";
import * as api from "../../api";
import { resyncSceneWithServer } from "./sceneResync";

vi.mock("../../api", () => ({
  getDrawing: vi.fn(),
}));

const buildRefs = (overrides: Record<string, any> = {}) => ({
  currentDrawingVersion: { current: 3 as number | null },
  excalidrawAPI: { current: null as any },
  isSyncing: { current: false },
  lastPersistedFiles: { current: {} as Record<string, any> },
  lastSyncedFiles: { current: {} as Record<string, any> },
  latestElements: { current: [] as readonly any[] },
  latestFiles: { current: {} as any },
  ...overrides,
});

describe("resyncSceneWithServer", () => {
  it("keeps the newer local element, adopts server-only elements and version", async () => {
    const localEdited = { id: "shared", type: "rectangle", version: 7, x: 10 };
    const serverStale = { id: "shared", type: "rectangle", version: 5, x: 0 };
    const serverOnly = { id: "from-server", type: "ellipse", version: 1 };
    vi.mocked(api.getDrawing).mockResolvedValue({
      version: 42,
      elements: [serverStale, serverOnly],
      files: { "file-1": { id: "file-1", dataURL: "data:image/png;base64,AA" } },
    } as any);
    const updateScene = vi.fn();
    const addFiles = vi.fn();
    const refs = buildRefs({
      excalidrawAPI: {
        current: {
          getSceneElementsIncludingDeleted: () => [localEdited],
          updateScene,
          addFiles,
        },
      },
    });

    const result = await resyncSceneWithServer("drawing-1", refs);

    expect(result.elements).toEqual([localEdited, serverOnly]);
    expect(result.version).toBe(42);
    expect(refs.currentDrawingVersion.current).toBe(42);
    expect(refs.latestElements.current).toEqual([localEdited, serverOnly]);
    expect(addFiles).toHaveBeenCalledTimes(1);
    expect(updateScene).toHaveBeenCalledWith(
      expect.objectContaining({ elements: [localEdited, serverOnly] }),
    );
    // Only the server files are known to be persisted, so a local-only image
    // still gets uploaded by the next save.
    expect(refs.lastPersistedFiles.current).toEqual({
      "file-1": { id: "file-1", dataURL: "data:image/png;base64,AA" },
    });
  });

  it("keeps the local scene when the server drawing is empty", async () => {
    const localElement = { id: "local", type: "rectangle", version: 2 };
    vi.mocked(api.getDrawing).mockResolvedValue({
      version: 8,
      elements: [],
      files: {},
    } as any);
    const refs = buildRefs({
      latestElements: { current: [localElement] },
    });

    const result = await resyncSceneWithServer("drawing-1", refs);

    expect(result.elements).toEqual([localElement]);
    expect(refs.currentDrawingVersion.current).toBe(8);
  });
});
