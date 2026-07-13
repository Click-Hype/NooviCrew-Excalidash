# ExcaliDash MCP for Hermes

Minimal stdio MCP/CLI for persistent canvases in ExcaliDash. It is isolated from the generic live-canvas package so Hermes loads only the MCP SDK dependency.

## Configuration

Set these outside Git with mode `0600`:

```dotenv
EXCALIDASH_URL=https://your-excalidash.example.com
EXCALIDASH_API_KEY=eca_...
```

The API key should use the default drawing/collection scopes plus opt-in `sharing:write` when the agent must share canvases. Password authentication remains a compatibility fallback and should not be used for agents.

Install and verify:

```bash
npm install
npm test
npm audit --omit=dev
```

Run the MCP:

```bash
node mcp.mjs
```

The `excalidash` launcher reads
`${XDG_CONFIG_HOME:-$HOME/.config}/excalidash/env` by default and starts the
CLI. Set `EXCALIDASH_ENV_FILE` to use another protected env file. Never place
that file inside a Git checkout.

## Agent guarantees

- `EXCALIDASH_URL` is mandatory; there is no implicit production fallback.
- Creates accept a stable request ID and are replay-safe.
- Scene replacement requires the latest `expectedVersion` and explicit confirmation.
- Folder paths are resolved level by level to avoid same-name ambiguity.
- Public links are view-only, and people shares require an exact email match.
- Compact reads avoid loading a full scene into agent context unless requested.

See `mcp.mjs` for the authoritative tool schemas and `lib.test.mjs` for safety regression tests.
