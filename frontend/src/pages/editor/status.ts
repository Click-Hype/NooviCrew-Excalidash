export type EditorSaveState =
  | "saved"
  | "dirty"
  | "saving"
  | "error"
  | "conflict";

export const canReloadForServerUpdate = (saveState: EditorSaveState) =>
  saveState === "saved";

export type EditorConnectionState =
  | "connecting"
  | "online"
  | "reconnecting"
  | "offline";
