# OpenCut Agent Guide

This repository is the user's OpenCut fork checkout. Follow these rules when an AI agent works in this repo.

## Repository state and remotes

- Treat `origin` as the upstream OpenCut repo (`OpenCut-app/OpenCut`) unless `git remote -v` proves otherwise.
- Treat `fork` as the user's writable fork (`H8Y8/OpenCut`) in this checkout.
- Do **not** push to upstream/origin unless the user explicitly asks for it.
- Before committing or pushing, run:
  ```sh
  git status --short --branch
  git remote -v
  ```
- Avoid broad `git add .`; stage only files relevant to the current task.

## Toolchain

OpenCut is managed with Proto, Bun, and Moon.

From repo root:

```sh
proto use
bun install
moon run web:dev
moon run api:dev
moon run mcp:dev
```

Common verification commands:

```sh
moon run mcp:test
moon run mcp:build
```

For direct MCP app work:

```sh
cd apps/mcp
bun run test
bun run build
```

## Current architecture reality

OpenCut `main` is a ground-up rewrite scaffold. The root `README.md` lists these as planned or emerging surfaces:

- Editor API
- third-party plugins
- desktop/mobile/browser from one codebase
- editor-control MCP server
- headless mode
- scripting tab

Do not invent missing editor APIs. If a task asks for actual video rendering, timeline import, or editor automation, first verify that a real execution surface exists in the checked-out code.

## AI video editing workflow

When the user asks for AI-assisted video editing, automatic cutting, reels/shorts, or large media-folder analysis:

1. Read `.claude/skills/opencut-ai-video-editor/SKILL.md` first.
2. Default to producing an edit-decision package unless a real OpenCut import/render surface is present.
3. Keep raw media untouched.
4. Write generated planning artifacts under `.ai-edits/<project-slug>/`.
5. Validate JSON edit decisions before reporting success.

Minimum reliable artifacts for plan-only mode:

- `.ai-edits/<project-slug>/creative-brief.md`
- `.ai-edits/<project-slug>/media-inventory.json`
- `.ai-edits/<project-slug>/analysis/scene-notes.md`
- `.ai-edits/<project-slug>/edit-decision.json`

## MCP app scope

`apps/mcp` is a local stdio MCP server for OpenCut edit-decision packages. It currently provides validation and summaries, not rendering or editor control.

Implemented tools:

- `opencut_get_capabilities`
- `opencut_validate_edit_decision`
- `opencut_summarize_edit_decision`

When changing `apps/mcp`, run:

```sh
cd apps/mcp
bun run test
bun run build
```

At least one test should exercise the MCP server over stdio when server behavior changes.

## Python helper scripts

The project skill includes no-dependency Python helpers:

```sh
python3 .claude/skills/opencut-ai-video-editor/scripts/media_inventory.py --help
python3 .claude/skills/opencut-ai-video-editor/scripts/validate_edit_decision.py --help
```

When changing those helpers, run:

```sh
python3 -m unittest discover .claude/skills/opencut-ai-video-editor/tests
```

## Reporting requirements

Before saying a change is done, report the exact commands run and their results. If video render/export was not performed, say so explicitly and provide the generated edit-decision package path instead.

Use Traditional Chinese when reporting back to the user in this environment.
