import { useCallback } from "react";
import type { MutableRefObject } from "react";

type UsePatchedExcalidrawApiInput = {
  drawingId?: string;
  excalidrawAPIRef: MutableRefObject<any>;
  patchedApisRef: MutableRefObject<WeakSet<object>>;
  isSyncing: MutableRefObject<boolean>;
  latestElementsRef: MutableRefObject<readonly any[]>;
  latestFilesRef: MutableRefObject<any>;
  latestAppStateRef: MutableRefObject<any>;
  debouncedSaveRef: MutableRefObject<
    | ((
        drawingId: string,
        elements: readonly any[],
        appState: any,
        files?: Record<string, any>,
      ) => void)
    | null
  >;
  hasSceneChangesSinceLoadRef: MutableRefObject<boolean>;
  emitFilesDeltaIfNeeded: (files: Record<string, any>) => boolean;
  setIsReady: (isReady: boolean) => void;
};

export const usePatchedExcalidrawApi = ({
  drawingId,
  excalidrawAPIRef,
  patchedApisRef,
  isSyncing,
  latestElementsRef,
  latestFilesRef,
  latestAppStateRef,
  debouncedSaveRef,
  hasSceneChangesSinceLoadRef,
  emitFilesDeltaIfNeeded,
  setIsReady,
}: UsePatchedExcalidrawApiInput) =>
  useCallback(
    (api: any) => {
      excalidrawAPIRef.current = api;
      if (import.meta.env.DEV) {
        (window as any).__EXCALIDASH_EXCALIDRAW_API__ = api;
      }
      if (
        api &&
        typeof api.addFiles === "function" &&
        !patchedApisRef.current.has(api as object)
      ) {
        patchedApisRef.current.add(api as object);
        const originalAddFiles = api.addFiles.bind(api);
        api.addFiles = (filesInput: Record<string, any> | any[]) => {
          const normalizedFiles = Array.isArray(filesInput)
            ? filesInput
            : Object.values(filesInput || {});
          originalAddFiles(normalizedFiles);
          if (isSyncing.current) return;
          const nextFiles = api.getFiles?.() || {};
          const didEmit = emitFilesDeltaIfNeeded(nextFiles);
          if (
            didEmit &&
            drawingId &&
            latestAppStateRef.current &&
            debouncedSaveRef.current
          ) {
            hasSceneChangesSinceLoadRef.current = true;
            debouncedSaveRef.current(
              drawingId,
              latestElementsRef.current,
              latestAppStateRef.current,
              latestFilesRef.current || {},
            );
          }
        };
      }
      setIsReady(true);
    },
    [
      debouncedSaveRef,
      drawingId,
      emitFilesDeltaIfNeeded,
      excalidrawAPIRef,
      hasSceneChangesSinceLoadRef,
      isSyncing,
      latestAppStateRef,
      latestElementsRef,
      latestFilesRef,
      patchedApisRef,
      setIsReady,
    ],
  );
