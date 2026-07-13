# ExcaliDash v0.6.0

Release date: 2026-07-12

This release completes nested folder organization, adds the repository-local
MCP integration for Hermes and other AI agents, and hardens concurrent editing,
authentication, sharing, storage, and production operations.

## Highlights

- Nested folders and subfolders with cycle prevention, deterministic sibling
  names, inherited sharing, hierarchy-aware import/export, and safe recursive
  deletion.
- A minimal persistent MCP with 23 tools, scoped API-key authentication,
  pagination, compact reads, reuse-first folder paths, idempotent canvas
  creation, and conflict-safe scene updates.
- Optimistic concurrency for drawing updates. Stale writers receive `409`
  instead of silently overwriting newer work.
- Editor save/offline/conflict states, safer history preview and restore, and
  improved dialog, keyboard, responsive, and error-state behavior.
- Hardened OIDC identity binding, onboarding, session revocation,
  impersonation, Socket.IO authorization, API-key scopes, and SVG processing.
- Private S3-compatible object storage with authorization enforced by the
  backend file proxy.
- Production preflight, smoke tests, safer environment initialization, release
  source archives, and CI coverage for the application and MCP.

## API compatibility note

Scene replacement now requires the latest drawing version. REST and MCP clients
must send `expectedVersion`; omitted versions return `428`, while stale versions
return `409`. Creation retries should reuse a stable idempotency key.

## Upgrade

1. Back up the database, object-storage bucket, uploads, and persisted secrets.
2. Keep `JWT_SECRET`, `CSRF_SECRET`, and `API_KEY_HASH_PEPPER` stable.
3. Pull both `0.6.0` images and update them together.
4. Allow startup migrations to finish before serving traffic.
5. Verify the backend health endpoint and application logs.

```yaml
services:
  backend:
    image: ghcr.io/click-hype/noovicrew-excalidash-backend:0.6.0
  frontend:
    image: ghcr.io/click-hype/noovicrew-excalidash-frontend:0.6.0
```

```bash
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d --wait
./scripts/production-smoke.sh
```

The frontend image serves the corresponding AGPL source bundle at
`/source/excalidash-source.tar.gz`. Release assets also include an explicit
source archive and SHA-256 checksums.

## Validation summary

- Backend unit/integration tests and production build.
- Frontend unit tests, lint, and production build.
- Playwright end-to-end browser suite.
- MCP unit tests, protocol handshake, and dependency audit.
- Full public-tree and Git-history secret scans.
- Production health, authentication, sharing, hierarchy, conflict, and private
  object-storage smoke tests.
