---
name: opencut-ai-video-editor
description: Use this skill whenever the user wants an AI agent to analyze many videos, images, transcripts, or audio files and automatically plan or drive an OpenCut edit. Trigger for OpenCut automation, AI video editing, auto-cutting reels/shorts, edit-decision JSON, subtitles/translation/dubbing, BGM selection, transitions, keyframes, effects, MCP/headless OpenCut, or Claude/Codex video post-production workflows—even if the user only says “剪影片”, “自動剪輯”, or “幫我做成影片”.
version: 0.2.0
author: Hermes Agent
license: MIT
compatibility: Project skill for Claude Code / Agent Skills. Works today as a planning and edit-decision workflow; execution mode requires a future OpenCut Editor API, MCP server, plugin, or headless renderer.
---

# OpenCut AI Video Editor Skill

## Purpose

Turn a large folder of raw videos, images, voice/audio, and a human creative brief into a concrete OpenCut editing plan. The plan must be specific enough for an agent, future MCP server, plugin, or headless renderer to apply without re-interpreting the user’s intent.

This skill follows the workflow implied by the Threads post the user referenced: do not rebuild a video editor from scratch; stand on OpenCut, use coding agents to add missing integration layers, then package repeated post-production expertise as Skills/Plugins. OpenCut `main` is currently a ground-up rewrite whose README lists Editor API, third-party plugins, MCP server, headless mode, and scripting tab as upcoming capabilities. Until those APIs exist locally, this skill’s reliable deliverable is an **edit-decision package** rather than a claimed finished export.

## Current OpenCut Checkout Reality Check

As of this skill version, the local `main` branch is the rewrite scaffold, not a usable editor automation surface:

- `README.md` lists Editor API, plugins, MCP server, headless mode, and scripting tab as planned rewrite goals.
- `apps/web/src/routes/index.tsx` currently renders only `hello world!`; there is no checked-in timeline/editor/export implementation to call.
- `apps/api/src/index.ts` exposes only `/`, `/health`, and `/echo` routes.

Therefore default to `plan-only` unless a future checkout adds an actual OpenCut MCP/API/plugin/headless renderer. Do not invent OpenCut APIs.

## Non-Negotiables

1. **Do not claim a rendered video exists unless a real render/export command succeeded.** If OpenCut MCP/headless/export is unavailable, say so and deliver the edit-decision package.
2. **Do not load all media into context.** Start with an inventory, then sample/analyze only representative frames, transcripts, and metadata.
3. **Keep raw media untouched.** Write all generated files under `.ai-edits/<project-slug>/` unless the user specifies another output folder.
4. **Local-first by default.** Do not upload private media to cloud tools unless the user explicitly approves that path.
5. **Every timeline item must trace back to a source asset.** Use stable relative paths and hashes from the media inventory.
6. **Use verifiable artifacts.** At minimum produce `media-inventory.json`, `creative-brief.md`, and `edit-decision.json`; validate JSON before handing off.

## Required Inputs

If missing, infer reasonable defaults and label them in `creative-brief.md` rather than blocking:

- Source media folder or file list.
- Desired output: platform/aspect ratio, target duration, language, style, topic, audience, must-use/must-avoid shots.
- Delivery mode:
  - `plan-only` — produce an edit-decision package.
  - `opencut-apply` — apply via an available OpenCut MCP/API/plugin/headless renderer.
  - `ffmpeg-preview` — optional rough preview when OpenCut execution is unavailable.

Default assumptions for social clips: 9:16, 30–60 seconds, Chinese captions if the user wrote Chinese, energetic opening hook, no copyrighted music unless the user supplied/approved it.

## Workflow

### 1. Create the workspace

```bash
mkdir -p .ai-edits/<project-slug>/{analysis,keyframes,transcripts,manifests,preview}
```

Write `.ai-edits/<project-slug>/creative-brief.md` with:

- User request, inferred defaults, and open questions.
- Output target: aspect ratio, duration, language, tone, pacing.
- Hard constraints: must-use assets, banned content, privacy/licensing notes.
- Acceptance criteria for this run.

Completion criterion: the brief is readable by a fresh agent without needing the chat history.

### 2. Build a media inventory

Run the bundled no-dependency scanner:

```bash
python3 .claude/skills/opencut-ai-video-editor/scripts/media_inventory.py \
  /path/to/media \
  -o .ai-edits/<project-slug>/media-inventory.json
```

Use `--no-probe` when `ffprobe` is unavailable or source files are placeholders.

Completion criterion: `media-inventory.json` exists, is valid JSON, and has nonzero `summary` counts for expected media types.

### 3. Analyze videos and images progressively

For videos, prefer the scene-aware `claude-real-video` pattern when available. Treat `crv` as an **optional external analysis helper**, not an OpenCut execution layer; if it is missing, use the fallback path and mark the method used in `scene-notes.md`.

```bash
crv /path/to/video.mp4 \
  --out .ai-edits/<project-slug>/analysis/<asset-stem> \
  --scene 0.30 \
  --fps-floor 1.0 \
  --max-frames 150 \
  --dedup-window 4 \
  --grid \
  --why "<user goal for this edit>" \
  --report
```

Read the generated `MANIFEST.txt` before looking at frames. Prefer contact sheets under `grids/` before opening individual frames; they preserve motion/progression while reducing context.

If `crv` is not installed, use `ffmpeg`/`ffprobe` to extract representative frames and audio/transcript artifacts, then clearly mark the analysis method as fallback.

For image-heavy folders, create a contact sheet or grouped visual summary rather than sending every image into context.

Completion criterion: each candidate source asset has at least one of: `crv` manifest/contact sheets, keyframes, transcript, metadata, or an explicit “skipped + reason” entry.

### 4. Produce semantic scene notes

Create `.ai-edits/<project-slug>/analysis/scene-notes.md` with a compact table:

| asset | time / image | visual content | transcript/audio | usefulness | suggested use |
|---|---:|---|---|---|---|

Rate each segment for:

- Hook strength.
- Visual quality and motion.
- Emotional beat / story beat.
- Relevance to user’s requested outcome.
- Caption/translation/dubbing needs.
- BGM mood cues.

Completion criterion: the later edit plan can be justified by scene notes, not by vague taste.

### 5. Design the edit

Choose a structure before listing clips. Common structures:

- Short social video: hook → proof/demo → payoff → CTA.
- Product/tutorial: problem → steps → result → reminder.
- Travel/event: atmosphere → highlights → human moment → closing.
- Photo montage: establish → clusters by theme/time → best hero shot → end card.

Then create `.ai-edits/<project-slug>/edit-decision.json` following `references/edit-decision.schema.json`.

Completion criterion: every clip/image/audio item has source path, source in/out when relevant, timeline start/duration, track, reason, and any transform/effect/caption instructions.

### 6. Add post-production layers

Use the Threads-inspired Skills/Plugin idea here:

- **Subtitles:** read/generate transcript, segment captions, translate if requested, specify burn-in style and safe-area position.
- **Voiceover/dubbing:** produce a script and language/voice requirements; do not call paid/cloud TTS without approval.
- **BGM:** analyze mood/tempo when audio is available; use Librosa-style descriptors (tempo, energy, onset density) and only recommend licensed/supplied music. YouTube/Meta music libraries are reference sources, not permission to use arbitrary copyrighted tracks.
- **Transitions/effects/keyframes:** specify intent and exact parameters in JSON; keep them minimal unless the requested style is flashy.

Completion criterion: each layer is either represented in `edit-decision.json` or explicitly marked out of scope.

### 7. Apply to OpenCut only when an execution surface exists

Before applying, discover whether the local OpenCut checkout has any of these:

- MCP server for editor control.
- Editor API / plugin API.
- Headless renderer.
- Import format matching `edit-decision.json` or a convertible timeline schema.
- Scripting tab / script runner.

If one exists, call it and save command logs under `.ai-edits/<project-slug>/manifests/`. If none exists, stop at the edit-decision package and state: “OpenCut execution surface is not available in this checkout.” `edit-decision.json` is this skill’s adapter boundary, not a verified native OpenCut import format unless a future checkout proves it.

Completion criterion for execution mode: real tool output proves the project was imported/rendered/exported.

### 8. Verify before reporting

Run these checks:

```bash
python3 -m json.tool .ai-edits/<project-slug>/media-inventory.json >/dev/null
python3 -m json.tool .ai-edits/<project-slug>/edit-decision.json >/dev/null
python3 .claude/skills/opencut-ai-video-editor/scripts/validate_edit_decision.py \
  .ai-edits/<project-slug>/edit-decision.json \
  --inventory .ai-edits/<project-slug>/media-inventory.json
python3 .claude/skills/opencut-ai-video-editor/tests/test_media_inventory.py
python3 .claude/skills/opencut-ai-video-editor/tests/test_validate_edit_decision.py
```

Manual checks:

- All `asset_path` values exist in the media inventory.
- Timeline duration is close to target duration.
- No raw media files were modified.
- Any unperformed render/export is reported as not done.

## Output Contract

Return a concise status with paths:

```text
Status: plan-only / opencut-applied / preview-rendered / blocked
Workspace: .ai-edits/<project-slug>/
Creative brief: .ai-edits/<project-slug>/creative-brief.md
Inventory: .ai-edits/<project-slug>/media-inventory.json
Scene notes: .ai-edits/<project-slug>/analysis/scene-notes.md
Edit plan: .ai-edits/<project-slug>/edit-decision.json
Render/export: <path or “not available in this checkout”>
Verification: <commands run + result>
```

## References

- `references/video-analysis-workflow.md` — detailed Threads + `claude-real-video` inspired process.
- `references/edit-decision.schema.json` — JSON schema for the edit package.
- `templates/edit-decision.example.json` — small example plan.
- `scripts/media_inventory.py` — deterministic media inventory helper.
- `scripts/validate_edit_decision.py` — no-dependency structural validator for edit packages.
