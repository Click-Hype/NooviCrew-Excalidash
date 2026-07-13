import React from "react";
import type { Collection } from "../types";
import {
  flattenCollectionTree,
  getCollectionSubtreeIds,
} from "../utils/collectionTree";

type MoveCollectionModalProps = {
  collection: Collection;
  collections: Collection[];
  parentId: string;
  onParentIdChange: (parentId: string) => void;
  onMove: (parentId: string | null) => void;
  onClose: () => void;
};

export const MoveCollectionModal: React.FC<MoveCollectionModalProps> = ({
  collection,
  collections,
  parentId,
  onParentIdChange,
  onMove,
  onClose,
}) => {
  const excludedIds = getCollectionSubtreeIds(collections, collection.id);
  const targets = flattenCollectionTree(
    collections.filter(
      (candidate) =>
        candidate.id !== "trash" &&
        candidate.isOwner !== false &&
        !excludedIds.has(candidate.id),
    ),
  );

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="move-collection-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <form
        className="w-full max-w-md rounded-xl border-2 border-black bg-white p-5 shadow-[5px_5px_0_0_rgba(0,0,0,1)] dark:border-neutral-700 dark:bg-neutral-900"
        onSubmit={(event) => {
          event.preventDefault();
          onMove(parentId || null);
        }}
      >
        <h2 id="move-collection-title" className="text-lg font-bold text-slate-900 dark:text-white">
          Move “{collection.name}”
        </h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-neutral-400">
          Its complete subfolder tree moves with it.
        </p>
        <label className="mt-4 block text-sm font-bold text-slate-700 dark:text-neutral-200" htmlFor="move-collection-parent">
          Parent folder
        </label>
        <select
          id="move-collection-parent"
          autoFocus
          value={parentId}
          onChange={(event) => onParentIdChange(event.target.value)}
          className="mt-2 w-full rounded-lg border-2 border-black bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-white"
        >
          <option value="">Top level</option>
          {targets.map((target) => (
            <option key={target.id} value={target.id}>
              {target.path}
            </option>
          ))}
        </select>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border-2 border-black px-4 py-2 text-sm font-bold dark:border-neutral-700 dark:text-white">
            Cancel
          </button>
          <button type="submit" className="rounded-lg border-2 border-black bg-indigo-600 px-4 py-2 text-sm font-bold text-white dark:border-neutral-700">
            Move
          </button>
        </div>
      </form>
    </div>
  );
};
