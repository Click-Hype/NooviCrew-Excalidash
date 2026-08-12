import React from "react";
import { Excalidraw, MainMenu } from "@excalidraw/excalidraw";
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Download,
  History,
  Loader2,
  Share2,
  Cloud,
  CloudAlert,
  Wifi,
  WifiOff,
} from "lucide-react";
import clsx from "clsx";
import { Toaster } from "sonner";
import {
  LanguageSelector,
} from "../../components/LanguageSelector";
import type { UserIdentity } from "../../utils/identity";
import { UIOptions } from "./shared";
import type { EditorConnectionState, EditorSaveState } from "./status";

interface Peer extends UserIdentity {
  isActive: boolean;
}

type EditorViewProps = {
  id?: string;
  accessLevel: "none" | "view" | "edit" | "owner";
  autoHideEnabled: boolean;
  canEdit: boolean;
  drawingName: string;
  editorContainerRef: React.RefObject<HTMLDivElement>;
  initialData: any;
  isHeaderVisible: boolean;
  isRenaming: boolean;
  isSavingOnLeave: boolean;
  isSceneLoading: boolean;
  langCode: string;
  loadError: string | null;
  me: UserIdentity;
  newName: string;
  peers: Peer[];
  theme: string;
  saveState: EditorSaveState;
  hasPendingServerUpdate: boolean;
  connectionState: EditorConnectionState;
  onBackClick: () => void;
  onCanvasChange: (elements: readonly any[], appState: any, files?: Record<string, any>) => void;
  onCanvasDropCapture: (event: React.DragEvent<HTMLDivElement>) => void;
  onExportClick: () => void;
  onLibraryChange: (items: readonly any[]) => void;
  onMergeServerVersion: () => void;
  onNavigateHome: () => void;
  onNewNameChange: (value: string) => void;
  onPointerUpdate: (payload: any) => void;
  onRenameBlur: () => void;
  onRenameStart: () => void;
  onRenameSubmit: (event: React.FormEvent) => void;
  onSetExcalidrawAPI: (api: any) => void;
  onSetLangCode: (langCode: string) => void;
  onShareOpen: () => void;
  onHistoryOpen: () => void;
  onToggleAutoHide: () => void;
};

const UserAvatar = ({
  user,
  label,
  inactive = false,
}: {
  user: UserIdentity;
  label: string;
  inactive?: boolean;
}) => (
  <div className="relative group">
    <div
      className={clsx(
        "w-9 h-9 rounded-xl flex items-center justify-center text-sm font-bold text-white shadow-sm transition-all duration-300",
        inactive && "opacity-30 grayscale",
      )}
      style={{ backgroundColor: user.color }}
      role="img"
      aria-label={label}
    >
      {user.initials}
    </div>
    <div className="absolute top-full mt-2 right-0 bg-gray-900 text-white text-xs py-1 px-2 rounded whitespace-nowrap z-50 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity">
      {label}
    </div>
  </div>
);

export const EditorView: React.FC<EditorViewProps> = ({
  id,
  accessLevel,
  autoHideEnabled,
  canEdit,
  drawingName,
  editorContainerRef,
  initialData,
  isHeaderVisible,
  isRenaming,
  isSavingOnLeave,
  isSceneLoading,
  langCode,
  loadError,
  me,
  newName,
  peers,
  theme,
  saveState,
  hasPendingServerUpdate,
  connectionState,
  onBackClick,
  onCanvasChange,
  onCanvasDropCapture,
  onExportClick,
  onLibraryChange,
  onMergeServerVersion,
  onNavigateHome,
  onNewNameChange,
  onPointerUpdate,
  onRenameBlur,
  onRenameStart,
  onRenameSubmit,
  onSetExcalidrawAPI,
  onSetLangCode,
  onShareOpen,
  onHistoryOpen,
  onToggleAutoHide,
}) => (
  <div className="h-screen flex flex-col bg-white dark:bg-neutral-950 overflow-hidden">
    <header
      className={clsx(
        "h-16 bg-white dark:bg-neutral-900 border-b border-gray-200 dark:border-neutral-800 flex items-center px-2 sm:px-4 justify-between z-10 fixed top-0 left-0 right-0 transition-transform duration-300 motion-reduce:transition-none",
        isHeaderVisible ? "translate-y-0" : "-translate-y-full",
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-1 sm:gap-4">
        <button
          onClick={onBackClick}
          disabled={isSavingOnLeave}
          aria-label={isSavingOnLeave ? "Saving changes" : "Back to dashboard"}
          className={`flex items-center gap-2 p-2 hover:bg-gray-100 dark:hover:bg-neutral-800 rounded-full text-gray-600 dark:text-gray-300 disabled:opacity-50 disabled:cursor-wait transition-all duration-200 ${isSavingOnLeave ? "pr-4" : ""}`}
        >
          {isSavingOnLeave ? (
            <>
              <Loader2 size={20} className="animate-spin" />
              <span className="text-sm font-medium">Saving changes...</span>
            </>
          ) : (
            <ArrowLeft size={20} />
          )}
        </button>
        {isRenaming ? (
          <form onSubmit={onRenameSubmit} className="min-w-0 flex-1">
            <input
              autoFocus
              type="text"
              value={newName}
              onChange={(e) => onNewNameChange(e.target.value)}
              onBlur={onRenameBlur}
              aria-label="Drawing name"
              className="w-full max-w-[240px] font-medium text-gray-900 dark:text-white bg-transparent px-2 py-1 border-2 border-indigo-500 rounded-md outline-none"
            />
          </form>
        ) : (
          <h1
            className="min-w-0 max-w-[32vw] truncate font-medium text-gray-900 dark:text-white px-2 py-1 hover:bg-gray-100 dark:hover:bg-neutral-800 rounded cursor-text"
            onDoubleClick={onRenameStart}
            title={`${drawingName}. Double-click to rename.`}
          >
            {drawingName}
          </h1>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-0.5 sm:gap-2 lg:gap-3">
        <div className="hidden md:flex items-center gap-1" aria-live="polite">
          {canEdit ? (
            <span
              className={clsx(
                "inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold",
                saveState === "saved" && "text-emerald-700 dark:text-emerald-300",
                (saveState === "dirty" || saveState === "saving") && "text-slate-600 dark:text-slate-300",
                (saveState === "error" || saveState === "conflict") && "text-rose-700 dark:text-rose-300",
              )}
              title={saveState === "conflict" ? "A newer server version exists. Export your work or reload before saving." : undefined}
            >
              {saveState === "error" || saveState === "conflict" ? <CloudAlert size={14} /> : saveState === "saved" ? <Cloud size={14} /> : <Loader2 size={14} className={saveState === "saving" ? "animate-spin" : ""} />}
              {saveState === "conflict" ? "Conflict" : saveState === "error" ? "Save failed" : saveState === "saving" ? "Saving" : saveState === "dirty" ? "Unsaved" : "Saved"}
            </span>
          ) : null}
          <span
            className={clsx(
              "inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold",
              connectionState === "online" ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300",
            )}
          >
            {connectionState === "online" ? <Wifi size={14} /> : <WifiOff size={14} />}
            {connectionState === "online" ? "Live" : connectionState === "connecting" ? "Connecting" : connectionState === "reconnecting" ? "Reconnecting" : "Offline"}
          </span>
        </div>
        {!canEdit ? (
          <span className="hidden sm:inline text-xs font-semibold px-2 py-1 rounded-full bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200 border border-amber-200 dark:border-amber-800">
            Read-only
          </span>
        ) : null}
        {canEdit && id ? (
          <button
            onClick={onHistoryOpen}
            aria-label="Open version history"
            className="p-2 hover:bg-gray-100 dark:hover:bg-neutral-800 rounded-lg text-gray-600 dark:text-gray-300 transition-colors"
            title="Version History"
          >
            <History size={20} />
          </button>
        ) : null}
        {accessLevel === "owner" && id ? (
          <button
            onClick={onShareOpen}
            aria-label="Open sharing settings"
            className="p-2 hover:bg-gray-100 dark:hover:bg-neutral-800 rounded-lg text-gray-600 dark:text-gray-300 transition-colors"
            title="Share"
          >
            <Share2 size={20} />
          </button>
        ) : null}
        <button
          onClick={onToggleAutoHide}
          aria-label={autoHideEnabled ? "Disable header auto-hide" : "Enable header auto-hide"}
          className="p-2 hover:bg-gray-100 dark:hover:bg-neutral-800 rounded-lg text-gray-600 dark:text-gray-300 transition-colors"
          title={autoHideEnabled ? "Disable auto-hide" : "Enable auto-hide"}
        >
          {autoHideEnabled ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
        </button>
        <div className="h-6 w-px bg-gray-300 dark:bg-gray-700" />
        <button
          onClick={onExportClick}
          aria-label="Export drawing"
          className="p-2 hover:bg-gray-100 dark:hover:bg-neutral-800 rounded-lg text-gray-600 dark:text-gray-300 transition-colors"
          title="Export drawing"
        >
          <Download size={20} />
        </button>
        <div className="h-6 w-px bg-gray-300 dark:bg-gray-700" />
        <div className="hidden lg:flex items-center">
          <UserAvatar user={me} label={`${me.name} (You)`} />
          <div className="h-6 w-px bg-gray-300 dark:bg-gray-700 mx-2" />
          <div className="flex items-center gap-2">
            {peers.map((peer) => (
              <UserAvatar
                key={peer.id}
                user={peer}
                label={peer.name}
                inactive={!peer.isActive}
              />
            ))}
          </div>
        </div>
      </div>
    </header>
    <div
      ref={editorContainerRef}
      className="flex-1 w-full relative transition-all duration-300"
      onDropCapture={onCanvasDropCapture}
      style={{
        height: isHeaderVisible ? "calc(100vh - 4rem)" : "100vh",
        marginTop: isHeaderVisible ? "4rem" : "0",
      }}
    >
      {loadError ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-white dark:bg-neutral-950 px-6">
          <div className="text-center">
            <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">
              Unable to open drawing
            </h2>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
              {loadError}
            </p>
          </div>
          <button
            onClick={onNavigateHome}
            className="px-4 py-2 rounded-lg border-2 border-black dark:border-neutral-700 bg-white dark:bg-neutral-900 text-gray-900 dark:text-gray-100 font-semibold hover:bg-gray-50 dark:hover:bg-neutral-800 transition-colors"
          >
            Back to dashboard
          </button>
        </div>
      ) : initialData ? (
        <Excalidraw
          key={id}
          theme={theme === "dark" ? "dark" : "light"}
          langCode={langCode}
          initialData={initialData}
          onChange={onCanvasChange}
          onPointerUpdate={onPointerUpdate}
          onLibraryChange={onLibraryChange}
          excalidrawAPI={onSetExcalidrawAPI}
          UIOptions={UIOptions}
          viewModeEnabled={!canEdit}
        >
          <MainMenu>
            <MainMenu.DefaultItems.ToggleTheme />
            <MainMenu.DefaultItems.SaveAsImage />
            <MainMenu.DefaultItems.ClearCanvas />
            <MainMenu.DefaultItems.ChangeCanvasBackground />
            <MainMenu.DefaultItems.Help />
            <MainMenu.Separator />
            <MainMenu.ItemCustom>
              <LanguageSelector langCode={langCode} onChange={onSetLangCode} />
            </MainMenu.ItemCustom>
          </MainMenu>
        </Excalidraw>
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-gray-500 dark:text-gray-400">
          <span className="text-sm font-medium">
            {isSceneLoading ? "Loading drawing..." : "Preparing canvas..."}
          </span>
        </div>
      )}
      {(saveState === "conflict" || hasPendingServerUpdate) && canEdit ? (
        <div
          role="alert"
          className="absolute bottom-4 left-1/2 z-50 w-[min(94vw,36rem)] -translate-x-1/2 rounded-xl border-2 border-rose-700 bg-rose-50 p-3 text-rose-950 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:bg-rose-950 dark:text-rose-100"
        >
          <p className="text-sm font-bold">
            {saveState === "conflict"
              ? "Saving paused because a newer server version exists."
              : "The drawing changed on the server while you had local work."}
          </p>
          <p className="mt-1 text-xs">
            Merging keeps both sides and resumes saving. Reloading discards
            anything drawn since the last successful save, so export first.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={onMergeServerVersion} className="rounded-lg border-2 border-black bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white">
              Merge and keep saving
            </button>
            <button type="button" onClick={onExportClick} className="rounded-lg border-2 border-black bg-white px-3 py-1.5 text-xs font-bold text-slate-900 dark:bg-neutral-900 dark:text-white">
              Export my work
            </button>
            <button type="button" onClick={() => window.location.reload()} className="rounded-lg border-2 border-black bg-rose-700 px-3 py-1.5 text-xs font-bold text-white">
              Reload latest
            </button>
          </div>
        </div>
      ) : null}
      {saveState === "error" && canEdit ? (
        <div role="alert" className="absolute bottom-4 left-1/2 z-50 w-[min(94vw,28rem)] -translate-x-1/2 rounded-xl border-2 border-amber-600 bg-amber-50 p-3 text-center text-sm font-semibold text-amber-950 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] dark:bg-amber-950 dark:text-amber-100">
          Autosave failed. Keep this tab open and press Ctrl/Cmd+S to retry.
        </div>
      ) : null}
      {connectionState !== "online" ? (
        <div role="status" className="absolute left-3 top-3 z-40 rounded-lg border border-amber-400 bg-amber-50 px-2.5 py-1.5 text-xs font-semibold text-amber-900 shadow-sm dark:bg-amber-950 dark:text-amber-100">
          {connectionState === "offline"
            ? "Offline: live collaboration is unavailable"
            : connectionState === "connecting"
              ? "Connecting to live collaboration…"
              : "Reconnecting live collaboration…"}
        </div>
      ) : null}
      <Toaster position="bottom-center" />
    </div>
  </div>
);
