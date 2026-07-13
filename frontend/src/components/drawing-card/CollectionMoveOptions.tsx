import React from "react";
import { Check } from "lucide-react";
import clsx from "clsx";
import type { Collection } from "../../types";
import { flattenCollectionTree } from "../../utils/collectionTree";

interface CollectionMoveOptionsProps {
  collections: Collection[];
  currentCollectionId: string | null;
  drawingId: string;
  onMoveToCollection: (id: string, collectionId: string | null) => void;
  onDone: () => void;
  optionClassName: string;
  selectedClassName: string;
  unselectedClassName: string;
  checkSize: number;
}

export const CollectionMoveOptions: React.FC<CollectionMoveOptionsProps> = ({
  collections,
  currentCollectionId,
  drawingId,
  onMoveToCollection,
  onDone,
  optionClassName,
  selectedClassName,
  unselectedClassName,
  checkSize,
}) => {
  const collectionOptions = flattenCollectionTree(
    collections.filter(
      (collection) => collection.id !== "trash" && collection.isOwner !== false,
    ),
  );
  const moveToCollection = (collectionId: string | null) => {
    onMoveToCollection(drawingId, collectionId);
    onDone();
  };

  return (
    <>
      <button
        data-testid="collection-option-unorganized"
        onClick={() => moveToCollection(null)}
        className={clsx(
          optionClassName,
          currentCollectionId === null
            ? selectedClassName
            : unselectedClassName,
        )}
      >
        Unorganized {currentCollectionId === null && <Check size={checkSize} />}
      </button>
      {collectionOptions.map((collection) => (
        <button
          key={collection.id}
          data-testid={`collection-option-${collection.id}`}
          onClick={() => moveToCollection(collection.id)}
          className={clsx(
            optionClassName,
            currentCollectionId === collection.id
              ? selectedClassName
              : unselectedClassName,
          )}
        >
          <span className="truncate" title={collection.path}>
            <span aria-hidden="true">{"  ".repeat(collection.depth)}</span>
            {collection.path}
          </span>
          {currentCollectionId === collection.id && <Check size={checkSize} />}
        </button>
      ))}
    </>
  );
};
