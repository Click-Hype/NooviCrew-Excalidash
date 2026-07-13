import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useEditorCanvasHandlers } from "./useEditorCanvasHandlers";

vi.mock("@excalidraw/excalidraw", () => ({
  CaptureUpdateAction: { IMMEDIATELY: "IMMEDIATELY" },
  convertToExcalidrawElements: vi.fn((elements) => elements),
  viewportCoordsToSceneCoords: vi.fn((point) => point),
}));

describe("useEditorCanvasHandlers", () => {
  it("does not broadcast or persist history preview scene changes", () => {
    const broadcastChanges = vi.fn();
    const previewElement = { id: "history", type: "rectangle" };
    const refs = {
      excalidrawAPI: {
        current: {
          getFiles: () => ({}),
          getSceneElementsIncludingDeleted: () => [previewElement],
        },
      },
      hasHydratedInitialScene: { current: true },
      hasSceneChangesSinceLoad: { current: false },
      initialSceneElements: { current: [] as readonly any[] },
      isBootstrappingScene: { current: false },
      isSyncing: { current: false },
      isUnmounting: { current: false },
      lastLocalChangeAt: { current: 0 },
      latestAppState: { current: null },
      latestElements: { current: [] as readonly any[] },
      latestFiles: { current: {} },
      debouncedSave: { current: null },
      suspiciousBlankLoad: { current: false },
      isPreviewingHistory: { current: true },
    };

    const { result } = renderHook(() =>
      useEditorCanvasHandlers({
        canEdit: true,
        debouncedSavePreview: vi.fn(),
        drawingId: "drawing-1",
        emitFilesDeltaIfNeeded: vi.fn(),
        isReady: false,
        refs,
        resolveSafeSnapshot: () => ({
          prevented: false,
          staleEmptySnapshot: false,
          staleNonRenderableSnapshot: false,
        }),
        broadcastChanges,
      }),
    );

    act(() => {
      result.current.handleCanvasChange([previewElement], {}, {});
    });

    expect(broadcastChanges).not.toHaveBeenCalled();
    expect(refs.latestElements.current).toEqual([]);
    expect(refs.latestAppState.current).toBeNull();
  });
});
