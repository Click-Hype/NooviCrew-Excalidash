# ExcaliDash MCP integration

This directory is distributed with ExcaliDash and contains two complementary
agent integrations:

- the upstream-derived live-canvas toolkit in the MCP root; and
- the minimal persistent ExcaliDash bridge in `excalidash/`, optimized for
  Hermes and other stdio MCP agents.

The persistent bridge talks only to the URL explicitly supplied through
`EXCALIDASH_URL`. Authentication should use an API key loaded from a protected
file outside the repository. No production URL, credential or agent-client
configuration is bundled here.

## Local development

```bash
cd MCP
npm ci
npm run type-check
npm run test:excalidash

cd excalidash
npm ci
npm test
```

The root project owns CI and releases. Workflows from the former standalone MCP
repository are intentionally not vendored into this monorepo.

## Licensing and provenance

The MCP subtree retains its MIT license and upstream attribution in
`MCP/LICENSE`. The remainder of ExcaliDash is licensed under AGPL-3.0-only; see
the repository-level `LICENSE` and `NOTICE` files.
