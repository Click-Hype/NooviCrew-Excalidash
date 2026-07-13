import { useMemo, useRef } from "react";
import type { MutableRefObject } from "react";

export const useEditorRuntimeRefs = () => {
  const isBootstrappingScene = useRef(true);
  const hasHydratedInitialScene = useRef(false);
  const isUnmountingRef = useRef(false);
  const latestElementsRef = useRef<readonly any[]>([]);
  const initialSceneElementsRef = useRef<readonly any[]>([]);
  const latestFilesRef = useRef<any>(null);
  const lastSyncedFilesRef = useRef<Record<string, any>>({});
  const lastSyncedElementOrderSigRef = useRef("");
  const lastPersistedFilesRef = useRef<Record<string, any>>({});
  const latestAppStateRef = useRef<any>(null);
  const debouncedSaveRef = useRef<
    | ((
        drawingId: string,
        elements: readonly any[],
        appState: any,
        files?: Record<string, any>,
      ) => void)
    | null
  >(null);
  const currentDrawingVersionRef = useRef<number | null>(null);
  const lastPersistedElementsRef = useRef<readonly any[]>([]);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const patchedAddFilesApisRef = useRef<WeakSet<object>>(new WeakSet());
  const suspiciousBlankLoadRef = useRef(false);
  const hasSceneChangesSinceLoadRef = useRef(false);
  const isPreviewingHistoryRef = useRef(false);
  const lastLocalChangeAtRef = useRef(0);
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const excalidrawAPI = useRef<any>(null);

  return useMemo(
    () => ({
      isBootstrappingScene,
      hasHydratedInitialScene,
      isUnmountingRef,
      latestElementsRef,
      initialSceneElementsRef,
      latestFilesRef,
      lastSyncedFilesRef,
      lastSyncedElementOrderSigRef,
      lastPersistedFilesRef,
      latestAppStateRef,
      debouncedSaveRef,
      currentDrawingVersionRef,
      lastPersistedElementsRef,
      saveQueueRef,
      patchedAddFilesApisRef,
      suspiciousBlankLoadRef,
      hasSceneChangesSinceLoadRef,
      isPreviewingHistoryRef,
      lastLocalChangeAtRef,
      editorContainerRef,
      excalidrawAPI,
    }),
    [],
  );
};

export type EditorRuntimeRefs = ReturnType<typeof useEditorRuntimeRefs>;

export const useEditorPersistenceRefs = (
  refs: EditorRuntimeRefs,
  isSyncing: MutableRefObject<boolean>,
) =>
  useMemo(
    () => ({
      currentDrawingVersion: refs.currentDrawingVersionRef,
      debouncedSave: refs.debouncedSaveRef,
      excalidrawAPI: refs.excalidrawAPI,
      isSyncing,
      isUnmounting: refs.isUnmountingRef,
      lastLocalChangeAt: refs.lastLocalChangeAtRef,
      lastPersistedElements: refs.lastPersistedElementsRef,
      lastPersistedFiles: refs.lastPersistedFilesRef,
      lastSyncedFiles: refs.lastSyncedFilesRef,
      latestAppState: refs.latestAppStateRef,
      latestElements: refs.latestElementsRef,
      latestFiles: refs.latestFilesRef,
      saveQueue: refs.saveQueueRef,
      suspiciousBlankLoad: refs.suspiciousBlankLoadRef,
    }),
    [isSyncing, refs],
  );

export const useEditorSceneLoaderRefs = (
  refs: EditorRuntimeRefs,
  elementVersionMap: MutableRefObject<Map<string, any>>,
) =>
  useMemo(
    () => ({
      elementVersionMap,
      saveQueue: refs.saveQueueRef,
      latestElements: refs.latestElementsRef,
      initialSceneElements: refs.initialSceneElementsRef,
      latestFiles: refs.latestFilesRef,
      lastSyncedFiles: refs.lastSyncedFilesRef,
      lastSyncedElementOrderSig: refs.lastSyncedElementOrderSigRef,
      lastPersistedFiles: refs.lastPersistedFilesRef,
      currentDrawingVersion: refs.currentDrawingVersionRef,
      lastPersistedElements: refs.lastPersistedElementsRef,
      suspiciousBlankLoad: refs.suspiciousBlankLoadRef,
      hasSceneChangesSinceLoad: refs.hasSceneChangesSinceLoadRef,
      excalidrawAPI: refs.excalidrawAPI,
      latestAppState: refs.latestAppStateRef,
      isBootstrappingScene: refs.isBootstrappingScene,
      hasHydratedInitialScene: refs.hasHydratedInitialScene,
    }),
    [elementVersionMap, refs],
  );

export const useEditorCanvasHandlerRefs = (
  refs: EditorRuntimeRefs,
  isSyncing: MutableRefObject<boolean>,
) =>
  useMemo(
    () => ({
      debouncedSave: refs.debouncedSaveRef,
      excalidrawAPI: refs.excalidrawAPI,
      hasHydratedInitialScene: refs.hasHydratedInitialScene,
      hasSceneChangesSinceLoad: refs.hasSceneChangesSinceLoadRef,
      initialSceneElements: refs.initialSceneElementsRef,
      isBootstrappingScene: refs.isBootstrappingScene,
      isSyncing,
      isUnmounting: refs.isUnmountingRef,
      lastLocalChangeAt: refs.lastLocalChangeAtRef,
      latestAppState: refs.latestAppStateRef,
      latestElements: refs.latestElementsRef,
      latestFiles: refs.latestFilesRef,
      suspiciousBlankLoad: refs.suspiciousBlankLoadRef,
      isPreviewingHistory: refs.isPreviewingHistoryRef,
    }),
    [isSyncing, refs],
  );

export const useEditorCommandRefs = (
  refs: EditorRuntimeRefs,
  saveData: MutableRefObject<any>,
  savePreview: MutableRefObject<any>,
) =>
  useMemo(
    () => ({
      excalidrawAPI: refs.excalidrawAPI,
      hasSceneChangesSinceLoad: refs.hasSceneChangesSinceLoadRef,
      latestFiles: refs.latestFilesRef,
      saveData,
      savePreview,
      suspiciousBlankLoad: refs.suspiciousBlankLoadRef,
    }),
    [refs, saveData, savePreview],
  );
