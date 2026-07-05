# OpenCut MCP Server

A local stdio MCP server for AI agents working with OpenCut edit-decision packages.

This server is intentionally conservative while the OpenCut rewrite is still building the real editor execution surface. It validates and summarizes AI-generated editing artifacts; it does **not** render video or import timelines into the editor until OpenCut exposes a verified Editor API, plugin API, native MCP surface, or headless renderer.

## Tools

- `opencut_get_capabilities` — returns the current automation capabilities and caveats.
- `opencut_validate_edit_decision` — validates an `edit-decision.json`, optionally against a `media-inventory.json`.
- `opencut_summarize_edit_decision` — returns a compact human-readable summary of an `edit-decision.json`.

## Development

From this directory:

```sh
bun install
bun run test
bun run build
bun run dev
```

From the repo root, Moon also discovers this app via `apps/*`:

```sh
moon run mcp:test
moon run mcp:build
moon run mcp:dev
```

## MCP client configuration

Use an absolute path so the client can start the server from any current working directory.

```json
{
  "mcpServers": {
    "opencut": {
      "command": "bun",
      "args": ["run", "/absolute/path/to/OpenCut/apps/mcp/src/server.ts"]
    }
  }
}
```

For this checkout, the absolute server path is:

```text
/Users/ethan/code/OpenCut/apps/mcp/src/server.ts
```

STDIO servers must not write normal logs to stdout. This server only uses stdout for MCP protocol messages; unexpected startup errors are written to stderr.
