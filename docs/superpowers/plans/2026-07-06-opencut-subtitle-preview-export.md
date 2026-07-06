# OpenCut Subtitle Preview Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve top-level edit-decision subtitle cues through timeline import and burn them into local `ffmpeg` preview exports.

**Architecture:** Keep subtitles as normalized data on `ImportedTimeline`, separate from clip/audio tracks. The `ffmpeg` renderer writes a temporary SRT file in the render work directory, then applies a final `subtitles=` video filter after visual concat and optional explicit audio mixing.

**Tech Stack:** TypeScript, Bun, Vitest, Node `fs/promises`, local `ffmpeg`/`ffprobe`.

## Global Constraints

- Do not claim native OpenCut editor import or native OpenCut headless rendering.
- Do not add production dependencies.
- Keep raw media untouched.
- Keep generated render scratch files under the requested `workDir`.
- Use TDD: write the failing test before production changes.
- Keep this pass to basic SRT burn-in; no custom font, style, positioning, or subtitle track export.

---

### Task 1: Normalize Top-Level Subtitle Cues

**Files:**
- Modify: `apps/mcp/src/timelineImport.ts`
- Modify: `apps/mcp/src/timelineImport.test.ts`
- Modify: `apps/mcp/src/editorSession.test.ts`
- Modify: `apps/mcp/src/render/ffmpeg.test.ts`
- Modify: `apps/mcp/src/render/ffmpeg.integration.test.ts`

**Interfaces:**
- Produces: `ImportedTimelineSubtitle` with `id`, `start`, `duration`, `text`, optional `language`, optional `style`.
- Produces: `ImportedTimeline.subtitles: ImportedTimelineSubtitle[]`.

- [ ] **Step 1: Write the failing import test**

Add this behavior to `apps/mcp/src/timelineImport.test.ts`:

```ts
it("normalizes top-level subtitle cues for renderer burn-in", () => {
  const plan = {
    ...validEditDecision(),
    subtitles: [
      {
        id: "caption-1",
        start: 0.5,
        duration: 1.25,
        text: "開場字幕",
        language: "zh-TW",
        style: "default",
      },
    ],
  };

  const timeline = importTimeline(plan, validInventory);

  expect(timeline.subtitles).toEqual([
    {
      id: "caption-1",
      start: 0.5,
      duration: 1.25,
      text: "開場字幕",
      language: "zh-TW",
      style: "default",
    },
  ]);
});
```

- [ ] **Step 2: Run the import test and verify RED**

Run: `cd apps/mcp && bun run test src/timelineImport.test.ts`

Expected before implementation: FAIL because `timeline.subtitles` is missing.

- [ ] **Step 3: Implement subtitle normalization**

Add `ImportedTimelineSubtitle`, add `subtitles` to `ImportedTimeline`, accept validated `subtitles` in the local `ValidatedEditDecision` type, and map `plan.subtitles ?? []` into the returned imported timeline.

- [ ] **Step 4: Repair typed test fixtures**

Add `subtitles: []` to existing hand-written `ImportedTimeline` fixtures in editor-session and renderer tests.

- [ ] **Step 5: Run focused verification**

Run: `cd apps/mcp && bun run test src/timelineImport.test.ts src/editorSession.test.ts src/render/ffmpeg.test.ts src/render/ffmpeg.integration.test.ts`

Expected: PASS, with integration tests rendering or skipping only when `ffmpeg` is unavailable.

### Task 2: Build SRT and Subtitle Burn-In Command Plan

**Files:**
- Modify: `apps/mcp/src/render/ffmpeg.ts`
- Modify: `apps/mcp/src/render/ffmpeg.test.ts`

**Interfaces:**
- Produces: optional `FfmpegRenderPlan.subtitleFilePath`.
- Produces: optional `FfmpegRenderPlan.subtitleFileContent`.
- Keeps: `buildFfmpegRenderPlan(timeline, options): FfmpegRenderPlan`.

- [ ] **Step 1: Write the failing render-plan test**

Add a timeline helper with:

```ts
subtitles: [{ id: "cap-1", start: 0.5, duration: 1, text: "Hello\nWorld" }]
```

Assert the plan writes `/tmp/project/.ai-edits/render-work/subtitles.srt`, includes:

```srt
1
00:00:00,500 --> 00:00:01,500
Hello
World
```

and appends a final `ffmpeg` step whose args contain `-vf` and `subtitles=/tmp/project/.ai-edits/render-work/subtitles.srt`.

- [ ] **Step 2: Run the render-plan test and verify RED**

Run: `cd apps/mcp && bun run test src/render/ffmpeg.test.ts`

Expected before implementation: FAIL because subtitle plan fields and final filter step do not exist.

- [ ] **Step 3: Implement minimal SRT plan support**

Add helpers in `apps/mcp/src/render/ffmpeg.ts`:

```ts
function subtitleItems(timeline: ImportedTimeline): ImportedTimeline["subtitles"] {
  return [...timeline.subtitles].sort((left, right) => left.start - right.start || left.id.localeCompare(right.id));
}

function srtTimestamp(seconds: number): string {
  const totalMilliseconds = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(totalMilliseconds / 3600000);
  const minutes = Math.floor((totalMilliseconds % 3600000) / 60000);
  const wholeSeconds = Math.floor((totalMilliseconds % 60000) / 1000);
  const milliseconds = totalMilliseconds % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(wholeSeconds).padStart(2, "0")},${String(milliseconds).padStart(3, "0")}`;
}
```

Use those helpers to write SRT content and add a final subtitle burn-in step.

- [ ] **Step 4: Run render-plan verification**

Run: `cd apps/mcp && bun run test src/render/ffmpeg.test.ts`

Expected: PASS.

### Task 3: Execute Subtitle File Writing and Smoke Render

**Files:**
- Modify: `apps/mcp/src/render/ffmpeg.ts`
- Modify: `apps/mcp/src/render/ffmpeg.test.ts`
- Modify: `apps/mcp/src/render/ffmpeg.integration.test.ts`

**Interfaces:**
- Keeps: `renderTimelineWithFfmpeg(...)` writes all generated plan files before executing command steps.

- [ ] **Step 1: Write the failing runtime write test**

Use injected `writeFile` and assert it receives both `concat.txt` and `subtitles.srt` when the timeline has subtitles.

- [ ] **Step 2: Run the runtime test and verify RED**

Run: `cd apps/mcp && bun run test src/render/ffmpeg.test.ts`

Expected before implementation: FAIL because only concat file is written.

- [ ] **Step 3: Write subtitle file before command execution**

In `renderTimelineWithFfmpeg`, after writing `concat.txt`, write `plan.subtitleFilePath` with `plan.subtitleFileContent` when both are present.

- [ ] **Step 4: Add integration smoke**

Add a real ffmpeg integration test that renders a short local clip with one subtitle cue and checks the output file exists and is non-empty.

- [ ] **Step 5: Run focused runtime verification**

Run: `cd apps/mcp && bun run test src/render/ffmpeg.test.ts src/render/ffmpeg.integration.test.ts`

Expected: PASS, with integration tests rendering or skipping only when `ffmpeg` is unavailable.

### Task 4: Document, Verify, Commit, Push

**Files:**
- Modify: `apps/mcp/README.md`

**Interfaces:**
- Keeps: CLI and MCP export behavior documented as an initial local `ffmpeg` adapter.

- [ ] **Step 1: Update README limitation statement**

Mention that the adapter burns top-level subtitle cues into preview exports using basic SRT burn-in, while custom subtitle styling is not implemented.

- [ ] **Step 2: Run full app verification**

Run:

```sh
cd apps/mcp && bun run test
cd apps/mcp && bun run build
```

Expected: both commands exit 0.

- [ ] **Step 3: Run repo-level MCP verification**

Run:

```sh
bunx @moonrepo/cli@2.3.3 run mcp:test
bunx @moonrepo/cli@2.3.3 run mcp:build
```

Expected: both commands exit 0.

- [ ] **Step 4: Commit and push**

Run:

```sh
git status --short --branch
git remote -v
git add docs/superpowers/plans/2026-07-06-opencut-subtitle-preview-export.md apps/mcp/src/timelineImport.ts apps/mcp/src/timelineImport.test.ts apps/mcp/src/editorSession.test.ts apps/mcp/src/render/ffmpeg.ts apps/mcp/src/render/ffmpeg.test.ts apps/mcp/src/render/ffmpeg.integration.test.ts apps/mcp/README.md
git commit -m "feat: burn subtitles in preview export"
git push fork feat/opencut-execution-layer
```

Expected: push updates only `fork`, not upstream `origin`.
