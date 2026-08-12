# Changelog

All notable changes to this downstream distribution are documented in this
file. The format is based on [Keep a Changelog](https://keepachangelog.com/),
and the project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.6.1] - 2026-08-12

### Fixed

- Autosave no longer stops for good when the server version moves ahead of the
  open editor. A rejected save now rebases the canvas on the server scene
  (element-wise reconciliation, newest version wins), adopts the server version
  and retries, so work drawn after the conflict is kept instead of requiring a
  reload. The conflict banner also offers merging, and an out-of-band update
  with local work pending is merged instead of forcing a reload.
- Scene updates no longer wrap the version guard and the history snapshot in a
  single interactive transaction. Large scenes could exceed the 5s transaction
  timeout, returning 500 to the editor while the update had already committed —
  the editor then kept a stale version and every later autosave failed with 409.
  Version history is now written after the guarded update, best-effort.

## [0.6.0] - 2026-07-12

### Added

- Nested folder and subfolder organization with hierarchy-aware import/export,
  sharing, move, and deletion behavior.
- A repository-local MCP integration for Hermes agents, including scoped API
  key authentication, pagination, idempotent creation, and optimistic version
  checks.
- Production environment initialization, preflight, smoke-test, and deployment
  hardening documentation.
- User-facing save, offline, conflict, retry, and history states in the editor.

### Changed

- Drawing updates now use optimistic concurrency and creation requests support
  idempotency to prevent agent and collaborative-editing overwrites.
- Object storage can remain private while authorized files are streamed through
  the backend.
- Collection sharing and folder-tree behavior now use explicit authorization
  and deterministic hierarchy rules.

### Security

- Hardened OIDC account binding, onboarding, session revocation,
  impersonation, Socket.IO authorization, API-key scopes, drawing history, and
  uploaded SVG processing.
- Added production validation for stable authentication, CSRF, and API-key
  secrets.

## [0.5.1] - 2026-06-21

### Added

- Runtime-selectable Prisma providers for SQLite and PostgreSQL deployments.
- Provider-specific migration and container health-check support.

### Changed

- Preserved SQLite as the default while enabling PostgreSQL through production
  configuration.

[Unreleased]: https://github.com/Click-Hype/NooviCrew-Excalidash/compare/v0.6.0...HEAD
[0.6.0]: https://github.com/Click-Hype/NooviCrew-Excalidash/releases/tag/v0.6.0
[0.5.1]: https://github.com/ZimengXiong/ExcaliDash/releases/tag/v0.5.1
