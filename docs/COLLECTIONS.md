# Collections and subfolders

Collections form an owner-scoped tree. A collection can be created or moved with a
`parentId`; `null` places it at the top level. The API rejects missing or cross-owner
parents, cycles, duplicate sibling names (case-insensitive), nesting under Trash, and
trees deeper than 20 levels.

Deleting a collection deletes its complete folder subtree, but never deletes drawings.
All drawings in that subtree are moved to **Unorganized** in one transaction. Moving a
collection moves its complete subtree.

Sharing a collection grants the selected role to that collection and all present or
future descendants. Overlapping shares use the strongest applicable role. Revoking a
root share revokes inherited access, but does not remove a separate share on a child.
`GET /collections` exposes `path`, `depth`, `sharedViaAncestor`, and
`shareSourceCollectionId` so clients and agents can explain effective access.

The `.excalidash` backup manifest remains format version 1 and now includes the optional
`parentId` field. Older backups import as top-level folders. New exports use stable,
nested archive paths and imports recreate parents after resolving ID conflicts, so an
export/import round trip preserves the tree on both SQLite and PostgreSQL.
