import React from "react";
import * as api from "../../api";
import type { Collection } from "../../types";
import { getCollectionSubtreeIds } from "../../utils/collectionTree";

type UseDashboardCollectionActionsParams = {
  collections: Collection[];
  selectedCollectionId: string | null | undefined;
  setSelectedCollectionId: (id: string | null | undefined) => void;
  setCollections: React.Dispatch<React.SetStateAction<Collection[]>>;
  refreshData: () => void;
};

export const useDashboardCollectionActions = ({
  collections,
  selectedCollectionId,
  setSelectedCollectionId,
  setCollections,
  refreshData,
}: UseDashboardCollectionActionsParams) => {
  const handleCreateCollection = async (name: string, parentId?: string | null) => {
    try {
      await api.createCollection(name, parentId);
      setCollections(await api.getCollections());
    } catch (err) {
      console.error("Failed to create collection:", err);
      refreshData();
    }
  };

  const handleEditCollection = async (
    id: string,
    name: string,
    parentId?: string | null,
  ) => {
    setCollections((current) =>
      current.map((collection) =>
        collection.id === id
          ? {
              ...collection,
              name,
              ...(parentId !== undefined ? { parentId } : {}),
            }
          : collection,
      ),
    );
    try {
      await api.updateCollection(
        id,
        parentId === undefined ? name : { name, parentId },
      );
      setCollections(await api.getCollections());
    } catch (err) {
      console.error("Failed to rename collection:", err);
      refreshData();
    }
  };

  const handleDeleteCollection = async (id: string) => {
    try {
      const subtreeIds = getCollectionSubtreeIds(collections, id);
      await api.deleteCollection(id);
      if (
        typeof selectedCollectionId === "string" &&
        subtreeIds.has(selectedCollectionId)
      ) {
        setSelectedCollectionId(undefined);
      }
      refreshData();
    } catch (err) {
      console.error("Failed to delete collection:", err);
      refreshData();
    }
  };

  return {
    handleCreateCollection,
    handleEditCollection,
    handleDeleteCollection,
  };
};
