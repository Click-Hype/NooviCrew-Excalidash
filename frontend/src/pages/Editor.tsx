import React, { useCallback, useEffect, useState, useRef } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { toast } from "sonner";
import { getInitialLangCode } from "../components/LanguageSelector";
import type { UserIdentity } from "../utils/identity";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import { getFilesDelta } from "./editor/shared";
import { useEditorChrome } from "./editor/useEditorChrome";
import { useEditorAutoHide } from "./editor/useEditorAutoHide";
import { useEditorIdentity } from "./editor/useEditorIdentity";
import { EditorDialogs } from "./editor/EditorDialogs";
import { EditorView } from "./editor/EditorView";
import { useLibraryImportFromUrl } from "./editor/useLibraryImportFromUrl";
import { useEditorSnapshotGuards } from "./editor/useEditorSnapshotGuards";
import { useEditorSceneLoader } from "./editor/useEditorSceneLoader";
import { useEditorCollaboration } from "./editor/useEditorCollaboration";
import { useEditorPersistence } from "./editor/useEditorPersistence";
import { useEditorCanvasHandlers } from "./editor/useEditorCanvasHandlers";
import { useEditorCommands } from "./editor/useEditorCommands";
import { useEditorElementTracking } from "./editor/useEditorElementTracking";
import { useEditorBroadcast } from "./editor/useEditorBroadcast";
import {
  useEditorCanvasHandlerRefs,
  useEditorCommandRefs,
  useEditorPersistenceRefs,
  useEditorRuntimeRefs,
  useEditorSceneLoaderRefs,
} from "./editor/useEditorRuntimeRefs";
import {
  useEditorSaveState,
  useProtectEditorExit,
} from "./editor/useEditorSaveState";
import { usePatchedExcalidrawApi } from "./editor/usePatchedExcalidrawApi";
export const Editor: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { theme } = useTheme();
  const { user } = useAuth();
  const [accessLevel, setAccessLevel] = useState<
    "none" | "view" | "edit" | "owner"
  >("none");
  const canEdit = accessLevel === "edit" || accessLevel === "owner";
  const [drawingName, setDrawingName] = useState("Drawing Editor");
  const [isRenaming, setIsRenaming] = useState(false);
  const [newName, setNewName] = useState("");
  const [initialData, setInitialData] = useState<any>(null);
  const [isSceneLoading, setIsSceneLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isSavingOnLeave, setIsSavingOnLeave] = useState(false);
  const runtimeRefs = useEditorRuntimeRefs();
  const {
    saveState,
    setSaveState,
    hasPendingServerUpdate,
    setHasPendingServerUpdate,
    handleServerDrawingUpdate,
    mergeServerUpdateRef,
  } = useEditorSaveState(id);
  const { autoHideEnabled, setAutoHideEnabled } = useEditorAutoHide(id);
  const [isShareOpen, setIsShareOpen] = useState(false);
  const [langCode, setLangCode] = useState(getInitialLangCode);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const previewBackup = useRef<{
    elements: readonly any[];
    appState: any;
    files: any;
  } | null>(null);
  const { isHeaderVisible, setIsHeaderVisible } = useEditorChrome({
    drawingName,
    autoHideEnabled,
    isRenaming,
  });
  const me: UserIdentity = useEditorIdentity(user);
  const [isReady, setIsReady] = useState(false);
  const {
    computeElementOrderSig,
    elementVersionMap,
    hasElementChanged,
    recordElementVersion,
  } = useEditorElementTracking();
  const {
    isUnmountingRef,
    latestElementsRef,
    initialSceneElementsRef,
    latestFilesRef,
    lastSyncedFilesRef,
    lastSyncedElementOrderSigRef,
    latestAppStateRef,
    debouncedSaveRef,
    lastPersistedElementsRef,
    patchedAddFilesApisRef,
    hasSceneChangesSinceLoadRef,
    isPreviewingHistoryRef,
    lastLocalChangeAtRef,
    editorContainerRef,
    excalidrawAPI,
  } = runtimeRefs;
  useEffect(() => {
    isPreviewingHistoryRef.current = false;
  }, [id, isPreviewingHistoryRef]);
  const { resolveSafeSnapshot, normalizeImageElementStatus } =
    useEditorSnapshotGuards({
      lastPersistedElementsRef,
      initialSceneElementsRef,
      latestElementsRef,
    });
  useEffect(() => {
    isUnmountingRef.current = false;
    return () => {
      isUnmountingRef.current = true;
    };
  }, [isUnmountingRef]);
  const handleSocketAccessDenied = useCallback(() => {
    if (!id || !location.pathname.startsWith("/editor/")) return;
    navigate(`/shared/${id}${location.search}${location.hash}`, {
      replace: true,
    });
  }, [id, location.hash, location.pathname, location.search, navigate]);
  const {
    peers,
    socketMeRef,
    socketRef,
    isSyncing,
    onPointerUpdate,
    connectionState,
  } =
    useEditorCollaboration({
      drawingId: id,
      me,
      isReady,
      excalidrawAPI,
      editorContainerRef,
      lastSyncedFilesRef,
      lastSyncedElementOrderSigRef,
      latestElementsRef,
      latestFilesRef,
      computeElementOrderSig,
      recordElementVersion,
      onAccessDenied: handleSocketAccessDenied,
      onServerDrawingUpdate: handleServerDrawingUpdate,
    });
  const emitFilesDeltaIfNeeded = useCallback(
    (nextFiles: Record<string, any>) => {
      if (!socketRef.current || !id) return false;
      const filesDelta = getFilesDelta(
        lastSyncedFilesRef.current,
        nextFiles || {},
      );
      if (Object.keys(filesDelta).length === 0) return false;
      latestFilesRef.current = nextFiles;
      lastSyncedFilesRef.current = nextFiles;
      socketRef.current.emit("element-update", {
        drawingId: id,
        elements: [],
        files: filesDelta,
        userId: socketMeRef.current.id,
      });
      setSaveState((current) =>
        current === "conflict" ? current : "dirty",
      );
      return true;
    },
    [
      id,
      lastSyncedFilesRef,
      latestFilesRef,
      setSaveState,
      socketMeRef,
      socketRef,
    ],
  );
  const setExcalidrawAPI = usePatchedExcalidrawApi({
    drawingId: id,
    excalidrawAPIRef: excalidrawAPI,
    patchedApisRef: patchedAddFilesApisRef,
    isSyncing,
    latestElementsRef,
    latestFilesRef,
    latestAppStateRef,
    debouncedSaveRef,
    hasSceneChangesSinceLoadRef,
    emitFilesDeltaIfNeeded,
    setIsReady,
  });
  useLibraryImportFromUrl({ excalidrawAPIRef: excalidrawAPI, isReady, user });
  const persistenceRefs = useEditorPersistenceRefs(runtimeRefs, isSyncing);
  const {
    debouncedSave,
    debouncedSaveLibrary,
    debouncedSavePreview,
    enqueueSceneSave,
    rebaseOnServerScene,
    saveDataRef,
    savePreviewRef,
    flushPendingSave,
  } = useEditorPersistence({
    refs: persistenceRefs,
    user,
    normalizeImageElementStatus,
    resolveSafeSnapshot,
    onSaveStateChange: setSaveState,
  });
  useProtectEditorExit({ canEdit, saveState, flushPendingSave });
  const mergeServerVersion = useCallback(async () => {
    if (!id) return;
    await rebaseOnServerScene(id);
  }, [id, rebaseOnServerScene]);
  useEffect(() => {
    mergeServerUpdateRef.current = mergeServerVersion;
  }, [mergeServerUpdateRef, mergeServerVersion]);
  const handleMergeServerVersionClick = useCallback(() => {
    void mergeServerVersion()
      .then(() => {
        setHasPendingServerUpdate(false);
        toast.success("Merged the server version and saved your drawing.");
      })
      .catch((err) => {
        console.error("[Editor] Manual merge with the server failed", err);
        toast.error("Could not merge the server version. Export your work first.");
      });
  }, [mergeServerVersion, setHasPendingServerUpdate]);
  const markSceneChangedSinceLoad = useCallback(() => {
    hasSceneChangesSinceLoadRef.current = true;
  }, [hasSceneChangesSinceLoadRef]);
  const broadcastChanges = useEditorBroadcast({
    drawingId: id,
    excalidrawAPI,
    lastLocalChangeAtRef,
    lastSyncedElementOrderSigRef,
    lastSyncedFilesRef,
    latestAppStateRef,
    latestFilesRef,
    socketMeRef,
    socketRef,
    debouncedSave,
    debouncedSavePreview,
    computeElementOrderSig,
    hasElementChanged,
    normalizeImageElementStatus,
    recordElementVersion,
    setHasSceneChangesSinceLoad: markSceneChangedSinceLoad,
    onLocalChange: () =>
      setSaveState((current) =>
        current === "conflict" ? current : "dirty",
      ),
  });
  const sceneLoaderRefs = useEditorSceneLoaderRefs(
    runtimeRefs,
    elementVersionMap,
  );
  useEditorSceneLoader({
    id,
    user,
    location,
    navigate,
    refs: sceneLoaderRefs,
    setAccessLevel,
    setDrawingName,
    setInitialData,
    setIsReady,
    setIsSceneLoading,
    setLoadError,
    recordElementVersion,
  });
  const canvasHandlerRefs = useEditorCanvasHandlerRefs(runtimeRefs, isSyncing);
  const { handleCanvasChange, handleCanvasDropCapture } =
    useEditorCanvasHandlers({
      canEdit,
      debouncedSavePreview,
      drawingId: id,
      emitFilesDeltaIfNeeded,
      isReady,
      refs: canvasHandlerRefs,
      resolveSafeSnapshot,
      broadcastChanges,
    });
  const commandRefs = useEditorCommandRefs(
    runtimeRefs,
    saveDataRef,
    savePreviewRef,
  );
  const {
    handleBackClick,
    handleExportClick,
    handleLibraryChange,
    handleRenameStart,
    handleRenameSubmit,
    handleToggleAutoHide,
  } = useEditorCommands({
    autoHideEnabled,
    canEdit,
    debouncedSaveLibrary,
    drawingId: id,
    drawingName,
    enqueueSceneSave,
    isSavingOnLeave,
    newName,
    refs: commandRefs,
    resolveSafeSnapshot,
    setAutoHideEnabled,
    setDrawingName,
    setIsHeaderVisible,
    setIsRenaming,
    setIsSavingOnLeave,
    setNewName,
    user,
  });

  return (
    <>
      <EditorView
        id={id}
        accessLevel={accessLevel}
        autoHideEnabled={autoHideEnabled}
        canEdit={canEdit}
        drawingName={drawingName}
        editorContainerRef={editorContainerRef}
        initialData={initialData}
        isHeaderVisible={isHeaderVisible}
        isRenaming={isRenaming}
        isSavingOnLeave={isSavingOnLeave}
        isSceneLoading={isSceneLoading}
        langCode={langCode}
        loadError={loadError}
        me={me}
        newName={newName}
        peers={peers}
        theme={theme}
        saveState={saveState}
        hasPendingServerUpdate={hasPendingServerUpdate}
        connectionState={connectionState}
        onBackClick={handleBackClick}
        onCanvasChange={handleCanvasChange}
        onCanvasDropCapture={handleCanvasDropCapture}
        onExportClick={handleExportClick}
        onLibraryChange={handleLibraryChange}
        onMergeServerVersion={handleMergeServerVersionClick}
        onNavigateHome={() => navigate("/")}
        onNewNameChange={setNewName}
        onPointerUpdate={onPointerUpdate}
        onRenameBlur={() => setIsRenaming(false)}
        onRenameStart={handleRenameStart}
        onRenameSubmit={handleRenameSubmit}
        onSetExcalidrawAPI={setExcalidrawAPI}
        onSetLangCode={setLangCode}
        onShareOpen={() => setIsShareOpen(true)}
        onHistoryOpen={() => setIsHistoryOpen(true)}
        onToggleAutoHide={handleToggleAutoHide}
      />
      <EditorDialogs
        drawingId={id}
        drawingName={drawingName}
        excalidrawAPIRef={excalidrawAPI}
        isHistoryOpen={isHistoryOpen}
        isShareOpen={isShareOpen}
        previewBackupRef={previewBackup}
        isPreviewingHistoryRef={isPreviewingHistoryRef}
        onCloseHistory={() => setIsHistoryOpen(false)}
        onCloseShare={() => setIsShareOpen(false)}
      />
    </>
  );
};
