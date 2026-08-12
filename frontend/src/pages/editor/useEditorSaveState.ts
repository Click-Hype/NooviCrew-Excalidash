import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { canReloadForServerUpdate, type EditorSaveState } from "./status";

type SaveStateUpdate =
  | EditorSaveState
  | ((current: EditorSaveState) => EditorSaveState);

export const useEditorSaveState = (drawingId?: string) => {
  const [saveState, setSaveStateValue] = useState<EditorSaveState>("saved");
  const saveStateRef = useRef<EditorSaveState>("saved");
  const [hasPendingServerUpdate, setHasPendingServerUpdate] = useState(false);
  const mergeServerUpdateRef = useRef<(() => Promise<unknown>) | null>(null);

  const setSaveState = useCallback((next: SaveStateUpdate) => {
    const resolved =
      typeof next === "function" ? next(saveStateRef.current) : next;
    saveStateRef.current = resolved;
    setSaveStateValue(resolved);
  }, []);

  useEffect(() => {
    setSaveState("saved");
    setHasPendingServerUpdate(false);
  }, [drawingId, setSaveState]);

  const warnAboutPendingServerUpdate = useCallback(() => {
    setHasPendingServerUpdate(true);
    toast.warning(
      "The server has a newer drawing. Export your local work before reloading.",
    );
  }, []);

  const handleServerDrawingUpdate = useCallback(() => {
    if (canReloadForServerUpdate(saveStateRef.current)) {
      toast.info("Drawing storage changed on the server. Reloading the editor.");
      window.location.reload();
      return;
    }
    // Reloading with local work pending would discard it, so merge the server
    // scene into the canvas instead and keep saving.
    const mergeServerUpdate = mergeServerUpdateRef.current;
    if (!mergeServerUpdate) {
      warnAboutPendingServerUpdate();
      return;
    }
    void mergeServerUpdate()
      .then(() => {
        setHasPendingServerUpdate(false);
        toast.info("Merged the newer server version into your drawing.");
      })
      .catch((err) => {
        console.error("[Editor] Failed to merge server drawing update", err);
        warnAboutPendingServerUpdate();
      });
  }, [warnAboutPendingServerUpdate]);

  return {
    saveState,
    setSaveState,
    hasPendingServerUpdate,
    setHasPendingServerUpdate,
    handleServerDrawingUpdate,
    mergeServerUpdateRef,
  };
};

export const useProtectEditorExit = ({
  canEdit,
  saveState,
  flushPendingSave,
}: {
  canEdit: boolean;
  saveState: EditorSaveState;
  flushPendingSave: () => Promise<void>;
}) => {
  useEffect(() => {
    const shouldProtectExit =
      canEdit &&
      (saveState === "dirty" ||
        saveState === "saving" ||
        saveState === "error" ||
        saveState === "conflict");
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!shouldProtectExit) return;
      void flushPendingSave();
      event.preventDefault();
      event.returnValue = "";
    };
    const handlePageHide = () => {
      if (shouldProtectExit) void flushPendingSave();
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("pagehide", handlePageHide);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.removeEventListener("pagehide", handlePageHide);
    };
  }, [canEdit, flushPendingSave, saveState]);
};
