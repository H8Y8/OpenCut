# OpenCut Execution Goals

Date: 2026-07-06

This document tracks the four requested OpenCut execution goals and the staged path to complete them using the Superpowers workflow.

## Current Repository Reality

The current OpenCut checkout is a rewrite scaffold. The README lists Editor API, editor-control MCP, headless mode, plugins, and scripting as planned capabilities. The existing `apps/mcp` server validates and summarizes edit-decision packages only. It does not import timelines into a native editor, control an editor session, or render video.

Because those native surfaces do not exist yet, the first practical implementation should create a narrow execution layer around the existing edit-decision package:

- Treat `edit-decision.json` as the timeline interchange format.
- Add tested MCP/server operations around importing, inspecting, controlling, and exporting a timeline package.
- Use local `ffmpeg` as the first headless render/export backend.
- Preserve a clean adapter boundary so future OpenCut Editor API, plugin API, or Rust renderer can replace the `ffmpeg` backend.

## Goals

### 1. OpenCut Timeline Import

Build a real import path that accepts an OpenCut AI edit-decision package and turns it into an internal executable timeline model.

Definition of done:

- Valid `edit-decision.json` can be loaded from disk.
- Optional `media-inventory.json` can be checked against the edit decision.
- Imported timeline has normalized tracks, ordered clips, source in/out points, durations, and asset references.
- Import rejects invalid or unsafe input with clear errors.
- Tests cover valid import, missing assets, overlapping items, unsupported track types, and malformed paths.

### 2. OpenCut Editor Control

Expose a minimal editor-control surface through the MCP server so an agent can load a timeline package, inspect state, select items, update simple timeline properties, and summarize the current session.

Definition of done:

- MCP exposes explicit control tools instead of only validation/summary tools.
- A control session can load one imported timeline at a time.
- Tools can return current timeline state in a structured format.
- Tools can update supported metadata or item timing in a deterministic way.
- Tests exercise the control API without relying on a graphical editor.

### 3. Headless Render/Export

Add a headless export adapter that renders an imported timeline to a video file without opening the web UI.

Definition of done:

- A command or MCP tool can render an imported timeline to an `.mp4` output path.
- Rendering uses local-only tools and does not upload media.
- First backend is `ffmpeg`, invoked through a small adapter with testable command generation.
- Export validates source paths, output path, track compatibility, and renderer availability before running.
- Tests cover command construction and failure handling. End-to-end render is verified when `ffmpeg` is installed.

### 4. Actually Cut Source Media Into A Video

Provide a working end-to-end path from source media plus edit-decision package to a rendered video file.

Definition of done:

- Given real local media and a valid edit decision, the execution layer produces an `.mp4`.
- The output respects clip order, trim ranges, durations, aspect ratio, and basic audio handling.
- Generated output is written under `.ai-edits/<project-slug>/preview/` or another explicit output path.
- Raw media files are never modified.
- Verification reports the exact render command, output file path, and any limitations.

## Proposed Completion Order

1. Timeline import model and validation boundary.
2. Editor-control MCP tools backed by the imported model.
3. Headless export adapter with `ffmpeg` command generation.
4. End-to-end render workflow using real or generated fixture media.

This order keeps each milestone independently testable and avoids pretending a native OpenCut editor surface exists before it does.

## Approaches Considered

### Recommended: MCP Execution Layer With `ffmpeg` Backend

This adds real import, control, and export capabilities around the existing `apps/mcp` server. It is achievable in the current checkout, local-first, and easy to test. The tradeoff is that the first renderer is an adapter, not the future native OpenCut renderer.

### Native Editor API First

This would build the missing Editor API, browser editor timeline, and renderer surface before adding MCP automation. It aligns with the long-term OpenCut roadmap, but it is too large for one implementation pass and would require inventing architecture beyond the current scaffold.

### Plan-Only Until Upstream API Exists

This keeps the current repo conservative and only expands edit-decision validation. It avoids architectural risk, but it does not satisfy the request to actually cut media into an output video.

## Recommended Design

Implement a minimal execution layer in `apps/mcp`:

- `timelineImport` module: converts validated edit decisions into a normalized executable timeline.
- `editorSession` module: owns one loaded timeline and exposes deterministic control operations.
- `render/ffmpeg` module: converts a normalized timeline into an `ffmpeg` command and runs it when requested.
- MCP tools: expose import, session inspection, supported edits, and render/export.

The first version should support the common case:

- Video tracks with sequential clips.
- Audio copied from video where possible.
- Images converted to timed still segments.
- Basic output sizing from timeline width/height or project aspect ratio.
- No transitions/effects beyond hard cuts unless already representable safely.

Unsupported edit-decision features should fail explicitly or be reported as skipped. They should not be silently ignored during export.

## Success Criteria

- The four goals above are represented by concrete tested code paths.
- Existing validation and summary behavior keeps working.
- No production dependency is added without confirmation.
- No raw media is modified.
- Verification includes `apps/mcp` test and build commands.
- If `ffmpeg` is unavailable, the implementation reports that render/export could not run and still verifies command generation tests.

## Approval Gate

Before implementation starts, confirm whether to use the recommended design:

Use `apps/mcp` as the first execution layer, treat `edit-decision.json` as the timeline import format, and use local `ffmpeg` as the initial headless render/export backend.
