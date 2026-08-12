import type { MutableRefObject } from "react";
import * as api from "../../api";
import { reconcileElements } from "../../utils/sync";
import { buildRemoteSceneUpdate } from "./shared";

export class DrawingSaveConflictError extends Error {
  constructor(message = "Drawing version conflict") {
    super(message);
    this.name = "DrawingSaveConflictError";
  }
}

/**
 * How many times a single save may rebase on the server scene before giving up
 * and surfacing the conflict. Two covers the realistic races (a lost response,
 * a peer or API-key write); more would only spin on a server that keeps moving.
 */
const MAX_CONFLICT_RECOVERIES = 2;

export type SceneResyncRefs = {
  currentDrawingVersion: MutableRefObject<number | null>;
  excalidrawAPI: MutableRefObject<any>;
  isSyncing: MutableRefObject<boolean>;
  lastPersistedFiles: MutableRefObject<Record<string, any>>;
  lastSyncedFiles: MutableRefObject<Record<string, any>>;
  latestElements: MutableRefObject<readonly any[]>;
  latestFiles: MutableRefObject<any>;
};

export type ResyncedScene = {
  elements: readonly any[];
  files: Record<string, any>;
  version: number | null;
};

/**
 * Rebases the local canvas on top of the current server scene.
 *
 * Scene saves are guarded by an optimistic-locking `version`. The editor only
 * learns the new version from its own successful save, so any write it does not
 * observe (a peer or API-key write, or its own write whose response was lost)
 * leaves the editor pinned to a stale version and every later autosave fails
 * with 409 until the page is reloaded — discarding everything drawn meanwhile.
 *
 * Instead of pausing saves, fetch the server scene, reconcile it element by
 * element with the canvas (same rule used for live collaboration: newest
 * element version wins) and adopt the server version, so the next save lands
 * carrying both sides of the work.
 */
export const resyncSceneWithServer = async (
  drawingId: string,
  refs: SceneResyncRefs,
  pending?: { elements?: readonly any[]; files?: Record<string, any> },
): Promise<ResyncedScene> => {
  const serverDrawing = await api.getDrawing(drawingId);
  const excalidrawAPI = refs.excalidrawAPI.current;
  const canvasElements =
    typeof excalidrawAPI?.getSceneElementsIncludingDeleted === "function"
      ? excalidrawAPI.getSceneElementsIncludingDeleted()
      : (refs.latestElements.current ?? []);
  // The scene that failed to save can carry elements the canvas no longer
  // reports (and vice versa); keep the newest of each side.
  const localElements = pending?.elements
    ? reconcileElements(pending.elements, canvasElements)
    : canvasElements;
  const localFiles = { ...(refs.latestFiles.current || {}), ...(pending?.files || {}) };
  const serverElements = Array.isArray(serverDrawing.elements)
    ? serverDrawing.elements
    : [];
  const serverFiles = (serverDrawing.files as Record<string, any>) || {};
  const { sceneUpdate, mergedElements, nextFiles, shouldUpdateFiles } =
    buildRemoteSceneUpdate({
      localElements,
      pendingElements: serverElements,
      lastSyncedFiles: localFiles,
      incomingFiles: serverFiles,
    });
  const elements = mergedElements ?? localElements;

  if (excalidrawAPI && sceneUpdate) {
    refs.isSyncing.current = true;
    try {
      if (shouldUpdateFiles && typeof excalidrawAPI.addFiles === "function") {
        excalidrawAPI.addFiles(Object.values(serverFiles));
      }
      excalidrawAPI.updateScene(sceneUpdate);
    } finally {
      refs.isSyncing.current = false;
    }
  }

  const version =
    typeof serverDrawing.version === "number" ? serverDrawing.version : null;
  refs.currentDrawingVersion.current = version;
  refs.latestElements.current = elements;
  refs.latestFiles.current = nextFiles;
  refs.lastSyncedFiles.current = nextFiles;
  // Only the server files are known to be persisted; a local-only image must
  // still be uploaded by the retried save.
  refs.lastPersistedFiles.current = serverFiles;

  console.warn("[Editor] Rebased local scene on the server version", {
    drawingId,
    version,
    localElementCount: localElements.length,
    serverElementCount: serverElements.length,
    mergedElementCount: elements.length,
  });

  return { elements, files: nextFiles, version };
};

/**
 * Runs a scene save, rebasing on the server scene whenever the version guard
 * rejects it. A stale version is never replayed as-is — that would overwrite
 * the newer server scene — so each retry carries the merged result.
 */
export const saveWithConflictRecovery = async ({
  drawingId,
  refs,
  elements,
  files,
  persistScene,
  normalizeElements,
}: {
  drawingId: string;
  refs: SceneResyncRefs;
  elements: readonly any[];
  files: Record<string, any>;
  persistScene: (
    sceneElements: readonly any[],
    sceneFiles: Record<string, any>,
  ) => Promise<void>;
  normalizeElements: (
    sceneElements: readonly any[],
    sceneFiles: Record<string, any>,
  ) => readonly any[];
}): Promise<void> => {
  let elementsToSave = elements;
  let filesToSave = files;
  for (let attempt = 0; ; attempt++) {
    try {
      await persistScene(elementsToSave, filesToSave);
      return;
    } catch (err) {
      if (
        !(err instanceof DrawingSaveConflictError) ||
        attempt >= MAX_CONFLICT_RECOVERIES
      ) {
        throw err;
      }
      const rebased = await resyncSceneWithServer(drawingId, refs, {
        elements: elementsToSave,
        files: filesToSave,
      });
      elementsToSave = Array.from(
        normalizeElements(rebased.elements, rebased.files),
      );
      filesToSave = rebased.files;
    }
  }
};
