# OpenCut MCP Server

A local stdio MCP server for AI agents working with OpenCut edit-decision packages.

This server is intentionally conservative while the OpenCut rewrite is still building the real editor execution surface. It validates and summarizes AI-generated editing artifacts, imports edit-decision timelines into an in-memory control session, and can export that loaded timeline through a local `ffmpeg` adapter.

The export tool is an initial local `ffmpeg` adapter for edit-decision timelines. It is not proof of native OpenCut editor import or native OpenCut headless rendering.

The adapter renders hard-cut video/image timelines, preserves visual timeline gaps as black silent segments, preserves source audio from video clips when available, mixes explicit `audio` track items into the final export, and burns top-level subtitle cues into preview exports through a basic SRT file. Successful renders write a JSON command manifest next to the preview workspace so an agent can audit the exact `ffmpeg` steps that produced the output. Video clips without audio and image clips receive silent fallback audio so concatenation remains deterministic. Overlapping visual items on the primary visual track are rejected instead of composited. Custom subtitle fonts, positioning, and style rendering are not implemented yet.

## Tools

- `opencut_get_capabilities` — returns the current automation capabilities and caveats.
- `opencut_validate_edit_decision` — validates an `edit-decision.json`, optionally against a `media-inventory.json`.
- `opencut_summarize_edit_decision` — returns a compact human-readable summary of an `edit-decision.json`.
- `opencut_import_timeline` — loads an edit-decision package into an in-memory control session.
- `opencut_get_timeline_state` — returns the loaded timeline state.
- `opencut_select_timeline_item` — selects an item in the loaded timeline.
- `opencut_update_timeline_item_timing` — updates basic item timing and trim metadata.
- `opencut_export_timeline` — renders the loaded timeline through local `ffmpeg`, or returns a dry-run command plan.

## Development

From this directory:

```sh
bun install
bun run test
bun run build
bun run dev
```

Export a loaded edit-decision timeline without writing a custom script:

```sh
bun run export -- /absolute/path/to/edit-decision.json \
  --inventory /absolute/path/to/media-inventory.json \
  --media-root /absolute/path/to/project \
  --out /absolute/path/to/project/preview/output.mp4
```

By default, successful renders write `/absolute/path/to/project/manifests/render-manifest.json` when the output path is `/absolute/path/to/project/preview/output.mp4`. Add `--manifest /absolute/path/to/project/manifests/custom-render.json` to choose a different manifest path.

Add `--dry-run` to print the `ffmpeg` command plan without rendering or writing a manifest.

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
