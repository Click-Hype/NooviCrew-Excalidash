import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import * as api from "../../api";
import { useEditorPersistence } from "./useEditorPersistence";

vi.mock("@excalidraw/excalidraw", () => ({
  exportToSvg: vi.fn(),
}));

vi.mock("../../api", () => ({
  getDrawing: vi.fn(),
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
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

const conflictResponse = (currentVersion: number) => ({
  isAxiosError: true,
  response: { status: 409, data: { currentVersion } },
});

const buildRefs = () => ({
  currentDrawingVersion: { current: 3 as number | null },
  debouncedSave: { current: null },
  excalidrawAPI: { current: null as any },
  isSyncing: { current: false },
  isUnmounting: { current: false },
  lastLocalChangeAt: { current: 0 },
  lastPersistedElements: { current: [] as readonly any[] },
  lastPersistedFiles: { current: {} as Record<string, any> },
  lastSyncedFiles: { current: {} as Record<string, any> },
  latestAppState: { current: {} as any },
  latestElements: { current: [] as readonly any[] },
  latestFiles: { current: {} as any },
  saveQueue: { current: Promise.resolve() },
  suspiciousBlankLoad: { current: false },
});

const renderPersistence = (
  refs: ReturnType<typeof buildRefs>,
  saveStates: string[],
) =>
  renderHook(() =>
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

describe("useEditorPersistence", () => {
  it("rebases on the server scene and retries after a 409", async () => {
    const localElement = { id: "local", type: "rectangle", version: 4 };
    const serverElement = { id: "remote", type: "ellipse", version: 2 };
    vi.mocked(api.getDrawing).mockResolvedValue({
      version: 9,
      elements: [serverElement],
      files: {},
    } as any);
    vi.mocked(api.updateDrawing)
      .mockRejectedValueOnce(conflictResponse(9))
      .mockResolvedValueOnce({ version: 10 } as any);
    const saveStates: string[] = [];
    const refs = buildRefs();

    const { result } = renderPersistence(refs, saveStates);

    await act(async () => {
      await result.current.saveDataRef.current?.(
        "drawing-1",
        [localElement],
        { viewBackgroundColor: "#fff" },
        {},
      );
    });

    expect(api.updateDrawing).toHaveBeenCalledTimes(2);
    // The stale snapshot is never replayed with the newer server version: the
    // retry carries the merged scene.
    expect(api.updateDrawing).toHaveBeenLastCalledWith(
      "drawing-1",
      expect.objectContaining({
        version: 9,
        elements: [localElement, serverElement],
      }),
    );
    expect(refs.currentDrawingVersion.current).toBe(10);
    expect(saveStates).toEqual(["saving", "saving", "saved"]);
  });

  it("surfaces the conflict when the server keeps moving", async () => {
    vi.mocked(api.getDrawing).mockResolvedValue({
      version: 9,
      elements: [],
      files: {},
    } as any);
    vi.mocked(api.updateDrawing).mockRejectedValue(conflictResponse(9));
    const saveStates: string[] = [];
    const refs = buildRefs();

    const { result } = renderPersistence(refs, saveStates);

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

    // Initial attempt plus the bounded rebase retries.
    expect(api.updateDrawing).toHaveBeenCalledTimes(3);
    expect(saveStates.at(-1)).toBe("conflict");
  });
});
