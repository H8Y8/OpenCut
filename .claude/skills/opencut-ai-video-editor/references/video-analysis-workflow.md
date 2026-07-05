# Video Analysis Workflow for OpenCut AI Editing

## Source strategy

The referenced Threads post argues for combining four layers instead of building a video editor from zero:

1. **Open-source base:** use OpenCut as the editor foundation.
2. **Coding agent:** use Codex/Claude to fill missing editor features such as transitions, keyframes, effects, and integration glue.
3. **MCP/plugin layer:** expose editor operations so agents can control the editor directly.
4. **Custom Skills/Plugins:** package repeatable post-production workflows: seeing video content, subtitles, translation, multilingual voiceover, BGM analysis/selection, and automated editing decisions.

OpenCut `main` currently describes Editor API, third-party plugins, MCP server, headless mode, and scripting tab as upcoming rewrite goals. Therefore the skill is designed to produce durable intermediate artifacts now, then become directly executable when those surfaces land.

Source anchors checked while authoring:

- Threads post: https://www.threads.com/@prompt_case/post/DaXnEEvFH63 — describes using OpenCut, Codex, an MCP layer, and custom Skills/Plugins for subtitles, translation, multilingual voiceover, Librosa, and YouTube/Meta BGM selection.
- OpenCut README: `README.md` — rewrite roadmap lists Editor API, third-party plugins, MCP server, headless mode, and scripting tab.
- Current local scaffold: `apps/web/src/routes/index.tsx` renders only `hello world!`; `apps/api/src/index.ts` only has root/health/echo routes, so there is no editor execution surface in this checkout.
- `claude-real-video`: https://github.com/HUANGCHIHHUNGLeo/claude-real-video — local scene-aware, deduplicated frames + transcript + manifest/contact sheets for LLM video understanding.

## Recommended analysis stages

### 1. Inventory before vision

Use `scripts/media_inventory.py` to create a stable list of files, types, sizes, hashes, and optional ffprobe metadata. This avoids loading hundreds of files into context and gives every later edit decision a stable source path.

### 2. Scene-aware video sampling

Borrow the `claude-real-video` idea:

- Detect scene changes instead of sampling fixed intervals only.
- Deduplicate near-identical frames.
- Keep a manifest of selected frames.
- Transcribe audio when possible.
- Preserve a report explaining why frames were kept/dropped.
- Use `--why` to carry the user’s editing objective into the manifest.
- Use `--grid` contact sheets first, then individual frames only for close-up inspection.

Preferred command when installed:

```bash
crv input.mp4 --out .ai-edits/<slug>/analysis/input --scene 0.30 --fps-floor 1.0 --max-frames 150 --dedup-window 4 --grid --why "<edit objective>" --report
```

Fallback when `crv` is unavailable:

```bash
ffprobe -v error -show_format -show_streams -print_format json input.mp4
ffmpeg -hide_banner -i input.mp4 -vf "select='gt(scene,0.30)',scale=640:-1" -vsync vfr .ai-edits/<slug>/keyframes/input-%04d.jpg
```

### 3. Transcript and subtitle layer

Create or collect:

- Original transcript with timecodes.
- Clean subtitle lines with max reading speed constraints.
- Translation targets if requested.
- Voiceover/dubbing script if requested.

Do not imply speech-to-text, translation, or TTS is complete unless the corresponding tool output exists.

### 4. Music/BGM layer

Use Librosa-style descriptors when audio analysis is available:

- Tempo / BPM.
- Energy / RMS.
- Beat density.
- Brightness / spectral centroid.
- Mood tags derived from user brief and scene notes.

Select only from user-supplied tracks or explicitly approved licensed libraries. YouTube/Meta music libraries can guide mood/reference matching, but do not grant permission for arbitrary copyrighted music.

### 5. Edit-decision package

Write `edit-decision.json` as the durable boundary between AI analysis and editor execution:

- `assets[]` maps source files to hashes and roles.
- `timeline.tracks[]` expresses clips/images/audio/captions with start/duration.
- `effects`, `transitions`, and `keyframes` specify exact intent.
- `rationale` preserves why each source was used.
- `open_questions` lists what still needs user or tool confirmation.

### 6. Execution adapters

When OpenCut exposes MCP/API/headless/plugin surfaces, write a thin adapter from `edit-decision.json` to that interface. Keep this adapter separate from analysis so the skill remains useful while OpenCut evolves.

## Quality gates

- The first 3 seconds must satisfy the hook requirement for social videos.
- Timeline duration should be within ±10% of the target unless the user asked for exact length.
- Every media reference must exist in `media-inventory.json`.
- `validate_edit_decision.py edit-decision.json --inventory media-inventory.json` must pass before claiming the edit package is ready.
- Captions must not overlap unless intentionally styled.
- BGM must not drown voiceover; specify ducking if voice/speech is present.
- Render/export must be backed by real command output, not assumed.
