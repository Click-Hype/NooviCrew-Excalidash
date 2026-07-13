# Contributing to ExcaliDash

Thank you for improving ExcaliDash. This repository is a downstream
distribution of the original
[ZimengXiong/ExcaliDash](https://github.com/ZimengXiong/ExcaliDash) project.
Please follow the [Code of Conduct](CODE_OF_CONDUCT.md) in all project spaces.

## Before you start

- Use GitHub Issues to propose bugs and focused enhancements.
- Use a private security advisory for vulnerabilities; see
  [SECURITY.md](SECURITY.md).
- Keep pull requests small enough to review and test independently.
- Do not commit `.env` files, credentials, private URLs, database files,
  drawings, logs containing personal data, or local Claude/Codex configuration.

## Development setup

Requirements are Node.js 20+, npm, and optionally Docker with Compose v2.

```bash
git clone https://github.com/Click-Hype/NooviCrew-Excalidash.git
cd NooviCrew-Excalidash
make install
make dev
```

Use `make dev-stop` when finished. See [README.md](README.md) for individual
backend/frontend commands and Docker workflows.

If you also need the original project as a Git remote:

```bash
git remote add upstream https://github.com/ZimengXiong/ExcaliDash.git
git fetch upstream
```

## Making a change

1. Create a branch from the current `main`.
2. Follow the existing TypeScript, React, Express, and Prisma patterns.
3. Add or update tests for behavior changes.
4. Update user and operator documentation when configuration or runtime
   behavior changes.
5. Add a concise entry under `Unreleased` in [CHANGELOG.md](CHANGELOG.md).

Do not change migration or persisted-secret behavior without explaining the
upgrade and rollback path. Agent-facing MCP changes must remain deterministic,
minimize returned context, enforce authorization scopes, and document any tool
schema changes.

## Validation

Run the checks relevant to the change:

```bash
make lint
make test
make build
```

For browser-visible or cross-service behavior:

```bash
make test-e2e
```

For the Hermes MCP integration:

```bash
cd MCP/excalidash
npm ci
npm test
```

Before changing production Compose or environment handling, also run:

```bash
./scripts/production-preflight.sh
```

## Pull requests

Describe the problem, the chosen solution, test evidence, operational impact,
and any migration or rollback requirements. Screenshots are welcome for UI
changes, but must contain only synthetic data. Link the related issue when one
exists.

By submitting a contribution, you agree that it is licensed under the
[GNU Affero General Public License v3.0](LICENSE), consistent with this
project's existing license and upstream obligations.

Only maintainers create release tags and publish artifacts. See
[RELEASE.md](RELEASE.md) for the release checklist.
