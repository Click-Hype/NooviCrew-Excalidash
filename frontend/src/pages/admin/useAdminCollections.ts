import { useState } from "react";
import type { NavigateFunction } from "react-router-dom";
import * as api from "../../api";
import type { Collection } from "../../types";

export const useAdminCollections = (navigate: NavigateFunction) => {
  const [collections, setCollections] = useState<Collection[]>([]);

  const loadCollections = async () => {
    try {
      const data = await api.getCollections();
      setCollections(data);
    } catch (err) {
      console.error("Failed to fetch collections:", err);
    }
  };

  const handleSelectCollection = (id: string | null | undefined) => {
    if (id === undefined) navigate("/");
    else if (id === null) navigate("/collections?id=unorganized");
    else navigate(`/collections?id=${id}`);
  };

  const handleCreateCollection = async (name: string, parentId?: string | null) => {
    await api.createCollection(name, parentId);
    const newCollections = await api.getCollections();
    setCollections(newCollections);
  };

  const handleEditCollection = async (id: string, name: string, parentId?: string | null) => {
    setCollections((prev) =>
      prev.map((collection) =>
        collection.id === id
          ? { ...collection, name, ...(parentId !== undefined ? { parentId } : {}) }
          : collection,
      ),
    );
    await api.updateCollection(id, parentId === undefined ? name : { name, parentId });
    setCollections(await api.getCollections());
  };

  const handleDeleteCollection = async (id: string) => {
    await api.deleteCollection(id);
    setCollections(await api.getCollections());
  };

  return {
    collections,
    loadCollections,
    handleSelectCollection,
    handleCreateCollection,
    handleEditCollection,
    handleDeleteCollection,
  };
};
