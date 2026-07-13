import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import * as api from "../../api";
import { useEditorPersistence } from "./useEditorPersistence";

vi.mock("@excalidraw/excalidraw", () => ({
  exportToSvg: vi.fn(),
}));

vi.mock("../../api", () => ({
  updateDrawing: vi.fn(),
  updateLibrary: vi.fn(),
  isAxiosError: (error: any) => Boolean(error?.isAxiosError),
}));

vi.mock("../../utils/imageCompression", () => ({
  compressExcalidrawFiles: async (files: Record<string, unknown>) => ({
    files,
    changed: false,
    changedIds: [],
  }),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

describe("useEditorPersistence", () => {
  it("does not retry a stale snapshot with the server version after a 409", async () => {
    vi.mocked(api.updateDrawing).mockRejectedValue({
      isAxiosError: true,
      response: { status: 409, data: { currentVersion: 9 } },
    });
    const saveStates: string[] = [];
    const refs = {
      currentDrawingVersion: { current: 3 },
      debouncedSave: { current: null },
      excalidrawAPI: { current: null },
      isSyncing: { current: false },
      isUnmounting: { current: false },
      lastLocalChangeAt: { current: 0 },
      lastPersistedElements: { current: [] as readonly any[] },
      lastPersistedFiles: { current: {} },
      lastSyncedFiles: { current: {} },
      latestAppState: { current: {} },
      latestElements: { current: [] as readonly any[] },
      latestFiles: { current: {} },
      saveQueue: { current: Promise.resolve() },
      suspiciousBlankLoad: { current: false },
    };

    const { result } = renderHook(() =>
      useEditorPersistence({
        refs,
        user: { id: "u1" },
        normalizeImageElementStatus: (elements) => elements ?? [],
        resolveSafeSnapshot: (snapshot = []) => ({
          snapshot,
          prevented: false,
          staleEmptySnapshot: false,
          staleNonRenderableSnapshot: false,
        }),
        onSaveStateChange: (state) => saveStates.push(state),
      }),
    );

    await act(async () => {
      await expect(
        result.current.saveDataRef.current?.(
          "drawing-1",
          [{ id: "local", type: "rectangle" }],
          { viewBackgroundColor: "#fff" },
          {},
        ),
      ).rejects.toThrow("Drawing version conflict");
    });

    expect(api.updateDrawing).toHaveBeenCalledTimes(1);
    expect(api.updateDrawing).toHaveBeenCalledWith(
      "drawing-1",
      expect.objectContaining({ version: 3 }),
    );
    expect(refs.currentDrawingVersion.current).toBe(3);
    expect(saveStates).toEqual(["saving", "conflict"]);
  });
});
