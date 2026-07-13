import React, { useState, useEffect } from "react";
import { Archive, ChevronRight, Folder, FolderOpen, FolderPlus, LayoutGrid, Plus, Shield } from "lucide-react";
import type { Collection } from "../types";
import clsx from "clsx";
import { ConfirmModal } from "./ConfirmModal";
import { ShareCollectionModal } from "./ShareCollectionModal";
import { Logo } from "./Logo";
import { useAuth } from "../context/AuthContext";
import { displayFontFamily } from "../utils/displayFont";
import { SidebarItem } from "./sidebar/SidebarItem";
import { SidebarFooter } from "./sidebar/SidebarFooter";
import {
  SidebarContextMenu,
  type SidebarContextMenuState,
} from "./sidebar/SidebarContextMenu";
import { MoveCollectionModal } from "./MoveCollectionModal";
interface SidebarProps {
  collections: Collection[];
  selectedCollectionId: string | null | undefined;
  onSelectCollection: (id: string | null | undefined) => void;
  onCreateCollection: (name: string, parentId?: string | null) => void;
  onEditCollection: (id: string, name: string, parentId?: string | null) => void;
  onDeleteCollection: (id: string) => void;
  onDrop?: (e: React.DragEvent, collectionId: string | null) => void;
}
export const Sidebar: React.FC<SidebarProps> = ({
  collections,
  selectedCollectionId,
  onSelectCollection,
  onCreateCollection,
  onEditCollection,
  onDeleteCollection,
  onDrop,
}) => {
  const { logout, user, authEnabled } = useAuth();
  const [isCreating, setIsCreating] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState("");
  const [createParentId, setCreateParentId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggleCollapsed = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [contextMenu, setContextMenu] = useState<SidebarContextMenuState | null>(null);
  const [collectionToDelete, setCollectionToDelete] = useState<string | null>(null);
  const [collectionToShare, setCollectionToShare] = useState<string | null>(null);
  const [collectionToMove, setCollectionToMove] = useState<Collection | null>(null);
  const [moveParentId, setMoveParentId] = useState<string>("");
  useEffect(() => {
    const handleClickOutside = () => setContextMenu(null);
    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, []);
  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (newCollectionName.trim()) {
      onCreateCollection(newCollectionName, createParentId);
      setNewCollectionName("");
      setIsCreating(false);
      setCreateParentId(null);
    }
  };
  const handleEditSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingId && editName.trim()) {
      onEditCollection(editingId, editName);
      setEditingId(null);
    }
  };
  const handleItemContextMenu = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    const collection = collections.find((c) => c.id === id);
    if (!collection?.isOwner && collection?.isOwner !== undefined) return;
    setContextMenu({ x: e.clientX, y: e.clientY, type: "item", id });
  };
  const handleBackgroundContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, type: "background" });
  };
  const ownedCollections = collections.filter((c) => c.name !== "Trash");
  const idSet = new Set(ownedCollections.map((c) => c.id));
  const sortCollections = (items: Collection[]) =>
    [...items].sort(
      (left, right) =>
        left.name.localeCompare(right.name, "en", { sensitivity: "base" }) ||
        left.id.localeCompare(right.id),
    );
  const childrenOf = (pid: string) =>
    sortCollections(ownedCollections.filter((c) => c.parentId === pid));
  const rootCollections = sortCollections(
    ownedCollections.filter((c) => !c.parentId || !idSet.has(c.parentId)),
  );
  const startSubfolder = (parentId: string) => {
    setCreateParentId(parentId);
    setNewCollectionName("");
    setIsCreating(true);
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.delete(parentId);
      return next;
    });
  };
  const renderCollectionTree = (
    nodes: Collection[],
    depth: number,
  ): React.ReactNode =>
    nodes.map((collection) => {
      const kids = childrenOf(collection.id);
      const hasKids = kids.length > 0;
      const isCollapsed = collapsed.has(collection.id);
      return (
        <div key={collection.id}>
          <div
            className="flex items-stretch"
            style={{ paddingLeft: depth > 0 ? depth * 14 : 0 }}
          >
            {hasKids ? (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  toggleCollapsed(collection.id);
                }}
                className="flex items-center justify-center w-5 shrink-0 text-slate-400 dark:text-neutral-500 hover:text-indigo-600"
                title={isCollapsed ? "Expand" : "Collapse"}
              >
                <ChevronRight
                  size={14}
                  className={clsx("transition-transform", !isCollapsed && "rotate-90")}
                />
              </button>
            ) : (
              <span className="w-5 shrink-0" />
            )}
            <div className="flex-1 min-w-0">
              <SidebarItem
                id={collection.id}
                icon={
                  selectedCollectionId === collection.id ? (
                    <FolderOpen size={18} />
                  ) : (
                    <Folder size={18} />
                  )
                }
                label={collection.name}
                isActive={selectedCollectionId === collection.id}
                onClick={() => onSelectCollection(collection.id)}
                onDoubleClick={() => {
                  setEditingId(collection.id);
                  setEditName(collection.name);
                }}
                onContextMenu={(e) => handleItemContextMenu(e, collection.id)}
                isEditing={editingId === collection.id}
                editValue={editName}
                onEditChange={setEditName}
                onEditSubmit={handleEditSubmit}
                onEditBlur={() => setEditingId(null)}
                onDrop={onDrop}
                extraAction={
                  <div className="flex items-center gap-1">
                    {collection.isOwner !== false && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          startSubfolder(collection.id);
                        }}
                        className="p-0.5 text-slate-400 dark:text-neutral-500 hover:text-indigo-600 dark:hover:text-neutral-200 opacity-0 group-hover/item:opacity-100 transition-opacity"
                        title="New subfolder"
                      >
                        <FolderPlus size={13} />
                      </button>
                    )}
                    {collection.isOwner !== false && collection.isShared && (
                      <span className="text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded border bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800">
                        Shared
                      </span>
                    )}
                    <span
                      className={clsx(
                        "text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded border shrink-0",
                        collection.isOwner === false
                          ? collection.sharedRole === "edit"
                            ? "bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800"
                            : "bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-800"
                          : "bg-slate-100 dark:bg-neutral-800 text-slate-400 dark:text-neutral-500 border-slate-200 dark:border-neutral-700",
                      )}
                    >
                      {collection.isOwner === false
                        ? collection.sharedRole === "edit"
                          ? "Editor"
                          : "Viewer"
                        : "Owner"}
                    </span>
                  </div>
                }
              />
            </div>
          </div>
          {isCreating && createParentId === collection.id && (
            <form
              onSubmit={handleCreateSubmit}
              className="mb-2 pr-2"
              style={{ paddingLeft: (depth + 1) * 14 + 20 }}
              onClick={(e) => e.stopPropagation()}
            >
              <input
                autoFocus
                type="text"
                value={newCollectionName}
                onChange={(e) => setNewCollectionName(e.target.value)}
                placeholder={`Subpasta de ${collection.name}...`}
                className="w-full px-3 py-2 text-sm bg-white dark:bg-neutral-800 border-2 border-black dark:border-neutral-700 rounded-lg shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] dark:shadow-[2px_2px_0px_0px_rgba(255,255,255,0.2)] outline-none placeholder:text-slate-400 dark:placeholder:text-neutral-500 font-bold text-slate-900 dark:text-white"
                onBlur={() => {
                  if (!newCollectionName) {
                    setIsCreating(false);
                    setCreateParentId(null);
                  }
                }}
              />
            </form>
          )}
          {hasKids && !isCollapsed && renderCollectionTree(kids, depth + 1)}
        </div>
      );
    });

  return (
    <>
      <div className="w-full flex flex-col h-full bg-transparent">
        <div className="p-4 sm:p-5 pb-2">
          <h1
            className="text-2xl text-slate-900 dark:text-white flex items-center gap-3 tracking-tight"
            style={{ fontFamily: displayFontFamily }}
          >
            <Logo className="w-10 h-10" />
            <span className="mt-1">ExcaliDash</span>
            <span
              className="text-xs font-bold text-red-500 mt-2"
              style={{ fontFamily: "sans-serif" }}
            >
              BETA
            </span>
          </h1>
        </div>
        <nav
          className="flex-1 overflow-y-auto py-3 sm:py-4 space-y-4 sm:space-y-8 custom-scrollbar"
          onContextMenu={handleBackgroundContextMenu}
        >
          <div className="space-y-1">
            <div className="px-6 pb-2 text-[11px] font-bold text-slate-400 dark:text-neutral-500 uppercase tracking-wider">
              Library
            </div>
            <div className="pl-3 pr-2">
              <button
                onClick={() => onSelectCollection(undefined)}
                className={clsx(
                  "w-full flex items-center gap-3 px-3 py-2.5 text-sm font-bold rounded-lg transition-all duration-200 border-2",
                  selectedCollectionId === undefined
                    ? "bg-indigo-50 dark:bg-neutral-800 text-indigo-900 dark:text-neutral-200 border-black dark:border-neutral-700 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] dark:shadow-[2px_2px_0px_0px_rgba(255,255,255,0.2)] -translate-y-0.5"
                    : "text-slate-600 dark:text-neutral-400 border-transparent hover:bg-slate-50 dark:hover:bg-neutral-800 hover:border-black dark:hover:border-neutral-700 hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] dark:hover:shadow-[2px_2px_0px_0px_rgba(255,255,255,0.2)] hover:-translate-y-0.5",
                )}
              >
                <LayoutGrid
                  size={18}
                  className={clsx(
                    selectedCollectionId === undefined
                      ? "text-indigo-900 dark:text-neutral-200"
                      : "text-slate-400 dark:text-neutral-500",
                  )}
                />
                <span className="min-w-0 flex-1 text-left">All Drawings</span>
              </button>
            </div>
            <SidebarItem
              id={"shared"}
              icon={<Shield size={18} />}
              label="Shared with me"
              isActive={selectedCollectionId === "shared"}
              onClick={() => onSelectCollection("shared")}
            />
            <SidebarItem
              id={null}
              icon={<Archive size={18} />}
              label="Unorganized"
              isActive={selectedCollectionId === null}
              onClick={() => onSelectCollection(null)}
              onDrop={onDrop}
            />
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-between px-6 pb-2 group/header">
              <span className="text-[11px] font-bold text-slate-400 dark:text-neutral-500 uppercase tracking-wider">
                Collections
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setCreateParentId(null);
                  setIsCreating(true);
                }}
                className="p-1 text-slate-400 dark:text-neutral-500 hover:text-indigo-600 dark:hover:text-neutral-200 hover:bg-indigo-50 dark:hover:bg-neutral-800 rounded-md transition-all opacity-0 group-hover/header:opacity-100"
                title="New Collection"
              >
                <Plus size={14} strokeWidth={2.5} />
              </button>
            </div>
            {isCreating && createParentId === null && (
              <form
                onSubmit={handleCreateSubmit}
                className="mb-2 px-4"
                onClick={(e) => e.stopPropagation()}
              >
                <input
                  autoFocus
                  type="text"
                  value={newCollectionName}
                  onChange={(e) => setNewCollectionName(e.target.value)}
                  placeholder="New Collection..."
                  className="w-full px-3 py-2 text-sm bg-white dark:bg-neutral-800 border-2 border-black dark:border-neutral-700 rounded-lg shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] dark:shadow-[2px_2px_0px_0px_rgba(255,255,255,0.2)] outline-none placeholder:text-slate-400 dark:placeholder:text-neutral-500 font-bold text-slate-900 dark:text-white"
                  onBlur={() => !newCollectionName && setIsCreating(false)}
                />
              </form>
            )}
            {renderCollectionTree(rootCollections, 0)}
          </div>
        </nav>
        <SidebarFooter
          selectedCollectionId={selectedCollectionId}
          authEnabled={authEnabled}
          user={user}
          onDrop={onDrop}
          onLogout={logout}
        />
      </div>
      {contextMenu && (
        <SidebarContextMenu
          contextMenu={contextMenu}
          collections={collections}
          onClose={() => setContextMenu(null)}
          onCreateCollection={() => {
            setCreateParentId(null);
            setIsCreating(true);
          }}
          onRenameCollection={(collection) => {
            setEditingId(collection.id);
            setEditName(collection.name);
          }}
          onMoveCollection={(collection) => {
            setCollectionToMove(collection);
            setMoveParentId(collection.parentId ?? "");
          }}
          onShareCollection={setCollectionToShare}
          onDeleteCollection={setCollectionToDelete}
        />
      )}
      <ConfirmModal
        isOpen={!!collectionToDelete}
        title="Delete Collection"
        message="Delete this collection and every subfolder below it? Drawings from the entire subtree will be moved to Unorganized. This does not delete drawings."
        confirmText="Delete Collection"
        onConfirm={() => {
          if (collectionToDelete) {
            onDeleteCollection(collectionToDelete);
            setCollectionToDelete(null);
          }
        }}
        onCancel={() => setCollectionToDelete(null)}
      />
      <ShareCollectionModal
        isOpen={!!collectionToShare}
        collectionId={collectionToShare ?? ""}
        collectionName={
          collections.find((c) => c.id === collectionToShare)?.name ?? ""
        }
        onClose={() => setCollectionToShare(null)}
      />
      {collectionToMove && (
        <MoveCollectionModal
          collection={collectionToMove}
          collections={collections}
          parentId={moveParentId}
          onParentIdChange={setMoveParentId}
          onMove={(parentId) => {
            onEditCollection(collectionToMove.id, collectionToMove.name, parentId);
            setCollectionToMove(null);
          }}
          onClose={() => setCollectionToMove(null)}
        />
      )}
    </>
  );
};
