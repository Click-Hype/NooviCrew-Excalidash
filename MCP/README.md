# ExcaliDash MCP for AI agents

This subtree contains the persistent stdio MCP and CLI used by Hermes agents
and other Model Context Protocol clients to work with ExcaliDash.

It is intentionally small and independent from the frontend editor. Agents can
list and create folders, create and update canvases, inspect compact scene
summaries, move content, and manage controlled sharing through the authenticated
ExcaliDash API.

## Install and test

```bash
cd MCP/excalidash
npm ci
npm test
npm audit --omit=dev
```

## Configure

Create a protected file outside the checkout, for example
`${XDG_CONFIG_HOME:-$HOME/.config}/excalidash/env`:

```dotenv
EXCALIDASH_URL=https://excalidash.example.com
EXCALIDASH_API_KEY=replace-with-a-scoped-api-key
```

Restrict it to the current user:

```bash
chmod 600 "${XDG_CONFIG_HOME:-$HOME/.config}/excalidash/env"
```

Run the server directly:

```bash
cd MCP/excalidash
node mcp.mjs
```

Or invoke the CLI wrapper:

```bash
MCP/excalidash/excalidash whoami
MCP/excalidash/excalidash list-folders
```

Client-specific configuration belongs in the user's home directory and must
not be committed. The repository contains no Claude Code, Codex, workstation,
production endpoint, or credential configuration.

See [the integration notes](EXCALIDASH.md) and
[the runtime documentation](excalidash/README.md) for behavior and safety
guarantees.

## Security model

- API-key authentication is preferred over passwords.
- Tools request only the scopes required for their operation.
- Canvas creation supports stable idempotency keys.
- Scene replacement requires `expectedVersion` and explicit confirmation.
- Sharing uses exact e-mail matching; public links are view-only.
- Folder creation is reuse-first and hierarchy-aware.
- Full scenes are loaded only when a tool explicitly needs them.

## License and attribution

The MCP subtree is distributed under the MIT License in [LICENSE](LICENSE).
The repository-level [NOTICE](../NOTICE) records its relationship to the
AGPL-licensed ExcaliDash application and the upstream MCP toolkit from which the
original integration work began.
