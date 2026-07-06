# OpenCut Execution Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first working execution layer for the four requested goals: timeline import, editor control, headless render/export, and producing an actual video from local media.

**Architecture:** Keep the current OpenCut rewrite honest by implementing execution inside `apps/mcp` rather than pretending a native editor API exists. `edit-decision.json` remains the timeline interchange format; a normalized imported timeline feeds an in-memory editor session and a local `ffmpeg` renderer. The renderer is isolated behind an adapter so a future native OpenCut Editor API, plugin API, or Rust renderer can replace it.

**Tech Stack:** TypeScript 6, Bun, Vitest, MCP SDK, Node built-ins, local `ffmpeg` when available. No new production dependencies.

## Global Constraints

- Treat `edit-decision.json` as the timeline interchange format.
- Add tested MCP/server operations around importing, inspecting, controlling, and exporting a timeline package.
- Use local `ffmpeg` as the first headless render/export backend.
- Preserve a clean adapter boundary so future OpenCut Editor API, plugin API, or Rust renderer can replace the `ffmpeg` backend.
- Existing validation and summary behavior keeps working.
- No production dependency is added without confirmation.
- No raw media is modified.
- If `ffmpeg` is unavailable, render/export reports that it could not run and command generation tests still pass.
- Keep `execution.openCutNativeImport`, `execution.editorApi`, and `execution.pluginApi` false until a native OpenCut surface exists.

---

## File Structure

- Create `apps/mcp/src/timelineImport.ts`: normalized executable timeline model and import validation.
- Create `apps/mcp/src/timelineImport.test.ts`: TDD coverage for timeline import.
- Create `apps/mcp/src/editorSession.ts`: in-memory editor-control session for one loaded timeline.
- Create `apps/mcp/src/editorSession.test.ts`: TDD coverage for editor state and updates.
- Create `apps/mcp/src/render/ffmpeg.ts`: `ffmpeg` render-plan generation and execution adapter.
- Create `apps/mcp/src/render/ffmpeg.test.ts`: TDD coverage for render command generation and validation.
- Create `apps/mcp/src/render/ffmpeg.integration.test.ts`: optional real render smoke test when `ffmpeg` is installed.
- Modify `apps/mcp/src/editDecision.ts`: extend reported MCP capabilities without claiming native OpenCut execution.
- Modify `apps/mcp/src/tools.ts`: add timeline import, state, control, and export handlers.
- Modify `apps/mcp/src/tools.test.ts`: handler-level coverage for new operations.
- Modify `apps/mcp/src/server.ts`: register new MCP tool schemas.
- Modify `apps/mcp/src/server.test.ts`: registered tool list coverage.
- Modify `apps/mcp/src/server.integration.test.ts`: stdio smoke coverage for at least timeline import/state.
- Modify `apps/mcp/README.md`: document honest capabilities and render limitations.

## Task 1: Timeline Import Model

**Files:**
- Create: `apps/mcp/src/timelineImport.ts`
- Create: `apps/mcp/src/timelineImport.test.ts`
- Modify: `apps/mcp/src/editDecision.ts`

**Interfaces:**
- Consumes: `validateEditDecision(editDecision: unknown, mediaInventory?: unknown): ValidationResult`
- Produces:
  - `type ImportedTimeline`
  - `type ImportedTimelineTrack`
  - `type ImportedTimelineItem`
  - `class TimelineImportError extends Error`
  - `function importTimeline(editDecision: unknown, mediaInventory?: unknown): ImportedTimeline`

- [ ] **Step 1: Write the failing timeline import tests**

Create `apps/mcp/src/timelineImport.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { TimelineImportError, importTimeline } from "./timelineImport";

function validEditDecision() {
  return {
    schema_version: "opencut.ai-edit-decision.v1",
    project: {
      title: "Launch reel",
      aspect_ratio: "9:16",
      target_duration_seconds: 6,
      language: "zh-TW",
    },
    assets: [
      { path: "media/clip-b.mp4", type: "video", sha256: "bbb" },
      { path: "media/clip-a.mp4", type: "video", sha256: "aaa" },
    ],
    timeline: {
      duration_seconds: 6,
      fps: 30,
      width: 1080,
      height: 1920,
      tracks: [
        {
          id: "v1",
          type: "video",
          items: [
            {
              id: "second",
              asset_path: "media/clip-b.mp4",
              start: 3,
              duration: 3,
              source_in: 1,
              source_out: 4,
              rationale: "Payoff.",
            },
            {
              id: "first",
              asset_path: "media/clip-a.mp4",
              start: 0,
              duration: 3,
              source_in: 0,
              source_out: 3,
              rationale: "Hook.",
            },
          ],
        },
      ],
    },
  };
}

const validInventory = {
  schema_version: "opencut.media-inventory.v1",
  root: "/tmp/project",
  assets: [
    { path: "media/clip-a.mp4", type: "video", sha256: "aaa" },
    { path: "media/clip-b.mp4", type: "video", sha256: "bbb" },
  ],
};

describe("importTimeline", () => {
  it("normalizes a valid edit decision into ordered executable timeline items", () => {
    const timeline = importTimeline(validEditDecision(), validInventory);

    expect(timeline.project.title).toBe("Launch reel");
    expect(timeline.durationSeconds).toBe(6);
    expect(timeline.fps).toBe(30);
    expect(timeline.width).toBe(1080);
    expect(timeline.height).toBe(1920);
    expect(timeline.tracks).toHaveLength(1);
    expect(timeline.tracks[0].items.map((item) => item.id)).toEqual(["first", "second"]);
    expect(timeline.tracks[0].items[0]).toMatchObject({
      assetPath: "media/clip-a.mp4",
      assetType: "video",
      start: 0,
      duration: 3,
      sourceIn: 0,
      sourceOut: 3,
    });
  });

  it("rejects invalid edit decisions with validation errors", () => {
    const plan = validEditDecision();
    plan.timeline.tracks[0].items[0].asset_path = "missing.mp4";

    expect(() => importTimeline(plan, validInventory)).toThrow(TimelineImportError);
    expect(() => importTimeline(plan, validInventory)).toThrow(
      "track 'v1' item[0] references asset_path not listed in assets: 'missing.mp4'",
    );
  });

  it("rejects unsafe asset paths before rendering can touch the filesystem", () => {
    const plan = validEditDecision();
    plan.assets[0].path = "../secret.mp4";
    plan.timeline.tracks[0].items[0].asset_path = "../secret.mp4";

    expect(() => importTimeline(plan)).toThrow("asset path must be relative and stay within the media root: ../secret.mp4");
  });

  it("rejects unsupported executable track types", () => {
    const plan = validEditDecision();
    plan.timeline.tracks[0].type = "overlay";

    expect(() => importTimeline(plan)).toThrow("track 'v1' has unsupported executable type: overlay");
  });
});
```

- [ ] **Step 2: Run the failing test**

Run: `cd apps/mcp && bun run test src/timelineImport.test.ts`

Expected: FAIL because `./timelineImport` does not exist.

- [ ] **Step 3: Implement the minimal importer**

Create `apps/mcp/src/timelineImport.ts` with:

```ts
import { isAbsolute } from "node:path";

import { validateEditDecision } from "./editDecision";

export type ImportedTimelineAssetType = "video" | "image" | "audio" | "subtitle" | "generated";
export type ImportedTimelineTrackType = "video" | "image" | "audio" | "subtitle";

export type ImportedTimelineAsset = {
  path: string;
  type: ImportedTimelineAssetType;
  sha256?: string;
};

export type ImportedTimelineItem = {
  id: string;
  trackId: string;
  trackType: ImportedTimelineTrackType;
  assetPath: string;
  assetType: ImportedTimelineAssetType;
  start: number;
  duration: number;
  sourceIn: number;
  sourceOut: number;
  rationale: string;
};

export type ImportedTimelineTrack = {
  id: string;
  type: ImportedTimelineTrackType;
  items: ImportedTimelineItem[];
};

export type ImportedTimeline = {
  project: {
    title: string;
    aspectRatio: string;
    targetDurationSeconds: number;
    language: string;
  };
  durationSeconds: number;
  fps: number;
  width: number;
  height: number;
  assets: ImportedTimelineAsset[];
  tracks: ImportedTimelineTrack[];
  warnings: string[];
};

export class TimelineImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TimelineImportError";
  }
}
```

Then implement `importTimeline` by:

```ts
export function importTimeline(editDecision: unknown, mediaInventory?: unknown): ImportedTimeline {
  const validation = validateEditDecision(editDecision, mediaInventory);
  if (!validation.valid) {
    throw new TimelineImportError(validation.errors.join("; "));
  }
  if (!isRecord(editDecision)) {
    throw new TimelineImportError("edit decision must be a JSON object");
  }

  const plan = editDecision as {
    project: { title: string; aspect_ratio: string; target_duration_seconds: number; language: string };
    assets: Array<{ path: string; type: ImportedTimelineAssetType; sha256?: string }>;
    timeline: {
      duration_seconds: number;
      fps?: number;
      width?: number;
      height?: number;
      tracks: Array<{
        id: string;
        type: string;
        items: Array<{
          id: string;
          asset_path: string;
          start: number;
          duration: number;
          source_in?: number;
          source_out?: number;
          rationale: string;
        }>;
      }>;
    };
  };

  const assetByPath = new Map<string, ImportedTimelineAsset>();
  const assets = plan.assets.map((asset) => {
    assertSafeRelativePath(asset.path);
    const imported = { path: asset.path, type: asset.type, sha256: asset.sha256 };
    assetByPath.set(asset.path, imported);
    return imported;
  });

  const tracks = plan.timeline.tracks.map((track) => {
    if (!isExecutableTrackType(track.type)) {
      throw new TimelineImportError(`track '${track.id}' has unsupported executable type: ${track.type}`);
    }
    const items = track.items
      .map((item) => {
        assertSafeRelativePath(item.asset_path);
        const asset = assetByPath.get(item.asset_path);
        if (asset === undefined) {
          throw new TimelineImportError(`item '${item.id}' references unknown asset: ${item.asset_path}`);
        }
        const sourceIn = item.source_in ?? 0;
        const sourceOut = item.source_out ?? sourceIn + item.duration;
        if (sourceOut <= sourceIn) {
          throw new TimelineImportError(`item '${item.id}' source_out must be greater than source_in`);
        }
        return {
          id: item.id,
          trackId: track.id,
          trackType: track.type,
          assetPath: item.asset_path,
          assetType: asset.type,
          start: item.start,
          duration: item.duration,
          sourceIn,
          sourceOut,
          rationale: item.rationale,
        };
      })
      .sort((left, right) => left.start - right.start || left.id.localeCompare(right.id));
    return { id: track.id, type: track.type, items };
  });

  return {
    project: {
      title: plan.project.title,
      aspectRatio: plan.project.aspect_ratio,
      targetDurationSeconds: plan.project.target_duration_seconds,
      language: plan.project.language,
    },
    durationSeconds: plan.timeline.duration_seconds,
    fps: plan.timeline.fps ?? 30,
    width: plan.timeline.width ?? widthFromAspectRatio(plan.project.aspect_ratio),
    height: plan.timeline.height ?? heightFromAspectRatio(plan.project.aspect_ratio),
    assets,
    tracks,
    warnings: validation.warnings,
  };
}
```

Add private helpers:

```ts
function assertSafeRelativePath(path: string): void {
  const parts = path.split(/[\\/]+/);
  if (path.length === 0 || isAbsolute(path) || parts.includes("..")) {
    throw new TimelineImportError(`asset path must be relative and stay within the media root: ${path}`);
  }
}

function isExecutableTrackType(value: string): value is ImportedTimelineTrackType {
  return value === "video" || value === "image" || value === "audio" || value === "subtitle";
}

function widthFromAspectRatio(aspectRatio: string): number {
  return aspectRatio === "16:9" ? 1920 : 1080;
}

function heightFromAspectRatio(aspectRatio: string): number {
  return aspectRatio === "16:9" ? 1080 : aspectRatio === "1:1" ? 1080 : 1920;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
```

- [ ] **Step 4: Update capabilities without claiming native import**

Modify `apps/mcp/src/editDecision.ts`:

```ts
execution: {
  openCutNativeImport: false,
  editorApi: false,
  pluginApi: false,
  headlessRender: false,
  editDecisionTimelineImport: true,
  mcpEditorControl: false,
  ffmpegRenderAdapter: false,
},
```

Update `OpenCutMcpCapabilities["execution"]` type with those three boolean fields.

- [ ] **Step 5: Run Task 1 tests**

Run: `cd apps/mcp && bun run test src/timelineImport.test.ts src/editDecision.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit Task 1**

```bash
git add apps/mcp/src/timelineImport.ts apps/mcp/src/timelineImport.test.ts apps/mcp/src/editDecision.ts apps/mcp/src/editDecision.test.ts
git commit -m "feat: import OpenCut edit decisions as timelines"
```

## Task 2: In-Memory Editor Control Session

**Files:**
- Create: `apps/mcp/src/editorSession.ts`
- Create: `apps/mcp/src/editorSession.test.ts`
- Modify: `apps/mcp/src/editDecision.ts`

**Interfaces:**
- Consumes: `ImportedTimeline`, `ImportedTimelineItem` from `timelineImport.ts`
- Produces:
  - `type EditorSessionState`
  - `class EditorSessionError extends Error`
  - `class OpenCutEditorSession`
  - `function summarizeTimelineState(state: EditorSessionState): string`

- [ ] **Step 1: Write the failing editor session tests**

Create `apps/mcp/src/editorSession.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { EditorSessionError, OpenCutEditorSession, summarizeTimelineState } from "./editorSession";
import type { ImportedTimeline } from "./timelineImport";

function importedTimeline(): ImportedTimeline {
  return {
    project: { title: "Launch reel", aspectRatio: "9:16", targetDurationSeconds: 6, language: "zh-TW" },
    durationSeconds: 6,
    fps: 30,
    width: 1080,
    height: 1920,
    assets: [{ path: "media/clip.mp4", type: "video" }],
    tracks: [
      {
        id: "v1",
        type: "video",
        items: [
          {
            id: "clip-1",
            trackId: "v1",
            trackType: "video",
            assetPath: "media/clip.mp4",
            assetType: "video",
            start: 0,
            duration: 6,
            sourceIn: 1,
            sourceOut: 7,
            rationale: "Hook.",
          },
        ],
      },
    ],
    warnings: [],
  };
}

describe("OpenCutEditorSession", () => {
  it("starts empty and reports that no timeline is loaded", () => {
    const session = new OpenCutEditorSession();

    expect(session.getState()).toEqual({ loaded: false });
  });

  it("loads one timeline and returns structured state", () => {
    const session = new OpenCutEditorSession();

    const state = session.load(importedTimeline(), { editDecisionPath: "/tmp/edit-decision.json" });

    expect(state.loaded).toBe(true);
    if (!state.loaded) throw new Error("Expected loaded state");
    expect(state.projectTitle).toBe("Launch reel");
    expect(state.source.editDecisionPath).toBe("/tmp/edit-decision.json");
    expect(state.trackCount).toBe(1);
    expect(state.itemCount).toBe(1);
    expect(state.selectedItemId).toBeUndefined();
  });

  it("selects an existing item and rejects missing item ids", () => {
    const session = new OpenCutEditorSession();
    session.load(importedTimeline(), {});

    expect(session.selectItem("clip-1").selectedItemId).toBe("clip-1");
    expect(() => session.selectItem("missing")).toThrow(EditorSessionError);
  });

  it("updates item timing deterministically and keeps source trim valid", () => {
    const session = new OpenCutEditorSession();
    session.load(importedTimeline(), {});

    const state = session.updateItemTiming("clip-1", { start: 2, duration: 3, sourceIn: 4, sourceOut: 7 });

    expect(state.loaded).toBe(true);
    if (!state.loaded) throw new Error("Expected loaded state");
    expect(state.timeline.tracks[0].items[0]).toMatchObject({
      id: "clip-1",
      start: 2,
      duration: 3,
      sourceIn: 4,
      sourceOut: 7,
    });
  });

  it("summarizes loaded state for human-facing MCP responses", () => {
    const session = new OpenCutEditorSession();
    const state = session.load(importedTimeline(), {});

    expect(summarizeTimelineState(state)).toContain("Project: Launch reel");
    expect(summarizeTimelineState(state)).toContain("Timeline: 6s, 1 track(s), 1 item(s)");
  });
});
```

- [ ] **Step 2: Run the failing test**

Run: `cd apps/mcp && bun run test src/editorSession.test.ts`

Expected: FAIL because `./editorSession` does not exist.

- [ ] **Step 3: Implement the session**

Create `apps/mcp/src/editorSession.ts` with a copy-on-write session:

```ts
import type { ImportedTimeline } from "./timelineImport";

export type EditorSessionSource = {
  editDecisionPath?: string;
  mediaInventoryPath?: string;
};

export type EditorSessionState =
  | { loaded: false }
  | {
      loaded: true;
      projectTitle: string;
      durationSeconds: number;
      width: number;
      height: number;
      fps: number;
      trackCount: number;
      itemCount: number;
      selectedItemId?: string;
      source: EditorSessionSource;
      timeline: ImportedTimeline;
    };

export type ItemTimingPatch = {
  start?: number;
  duration?: number;
  sourceIn?: number;
  sourceOut?: number;
};

export class EditorSessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EditorSessionError";
  }
}

export class OpenCutEditorSession {
  private timeline?: ImportedTimeline;
  private source: EditorSessionSource = {};
  private selectedItemId?: string;

  getState(): EditorSessionState {
    if (this.timeline === undefined) {
      return { loaded: false };
    }
    return loadedState(this.timeline, this.source, this.selectedItemId);
  }

  load(timeline: ImportedTimeline, source: EditorSessionSource): EditorSessionState {
    this.timeline = cloneTimeline(timeline);
    this.source = { ...source };
    this.selectedItemId = undefined;
    return this.getState();
  }

  selectItem(itemId: string): EditorSessionState {
    const timeline = this.requireTimeline();
    if (findItem(timeline, itemId) === undefined) {
      throw new EditorSessionError(`timeline item not found: ${itemId}`);
    }
    this.selectedItemId = itemId;
    return this.getState();
  }

  updateItemTiming(itemId: string, patch: ItemTimingPatch): EditorSessionState {
    const timeline = cloneTimeline(this.requireTimeline());
    const item = findItem(timeline, itemId);
    if (item === undefined) {
      throw new EditorSessionError(`timeline item not found: ${itemId}`);
    }
    const nextStart = patch.start ?? item.start;
    const nextDuration = patch.duration ?? item.duration;
    const nextSourceIn = patch.sourceIn ?? item.sourceIn;
    const nextSourceOut = patch.sourceOut ?? item.sourceOut;
    if (nextStart < 0) throw new EditorSessionError("item start must be non-negative");
    if (nextDuration <= 0) throw new EditorSessionError("item duration must be positive");
    if (nextSourceIn < 0) throw new EditorSessionError("item sourceIn must be non-negative");
    if (nextSourceOut <= nextSourceIn) throw new EditorSessionError("item sourceOut must be greater than sourceIn");
    item.start = nextStart;
    item.duration = nextDuration;
    item.sourceIn = nextSourceIn;
    item.sourceOut = nextSourceOut;
    sortTimeline(timeline);
    this.timeline = timeline;
    this.selectedItemId = itemId;
    return this.getState();
  }

  private requireTimeline(): ImportedTimeline {
    if (this.timeline === undefined) {
      throw new EditorSessionError("no timeline is loaded");
    }
    return this.timeline;
  }
}
```

Add helpers:

```ts
export function summarizeTimelineState(state: EditorSessionState): string {
  if (!state.loaded) return "No OpenCut timeline is loaded.";
  return [
    `Project: ${state.projectTitle}`,
    `Timeline: ${state.durationSeconds}s, ${state.trackCount} track(s), ${state.itemCount} item(s)`,
    `Canvas: ${state.width}x${state.height} @ ${state.fps}fps`,
    `Selected item: ${state.selectedItemId ?? "none"}`,
  ].join("\n");
}
```

Implement `cloneTimeline`, `findItem`, `sortTimeline`, and `loadedState` with JSON-compatible shallow data only; do not mutate caller-owned timeline objects.

- [ ] **Step 4: Update capabilities**

Modify `apps/mcp/src/editDecision.ts` so `execution.mcpEditorControl` is `true`.

- [ ] **Step 5: Run Task 2 tests**

Run: `cd apps/mcp && bun run test src/editorSession.test.ts src/editDecision.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit Task 2**

```bash
git add apps/mcp/src/editorSession.ts apps/mcp/src/editorSession.test.ts apps/mcp/src/editDecision.ts apps/mcp/src/editDecision.test.ts
git commit -m "feat: add OpenCut editor session control"
```

## Task 3: MCP Timeline Import And Control Tools

**Files:**
- Modify: `apps/mcp/src/tools.ts`
- Modify: `apps/mcp/src/tools.test.ts`
- Modify: `apps/mcp/src/server.ts`
- Modify: `apps/mcp/src/server.test.ts`
- Modify: `apps/mcp/src/server.integration.test.ts`

**Interfaces:**
- Consumes:
  - `importTimeline(editDecision, mediaInventory)`
  - `OpenCutEditorSession`
- Produces new MCP handler methods:
  - `importTimeline(input: { editDecisionPath: string; mediaInventoryPath?: string }): Promise<McpTextResponse>`
  - `getTimelineState(): Promise<McpTextResponse>`
  - `selectTimelineItem(input: { itemId: string }): Promise<McpTextResponse>`
  - `updateTimelineItemTiming(input: { itemId: string; start?: number; duration?: number; sourceIn?: number; sourceOut?: number }): Promise<McpTextResponse>`

- [ ] **Step 1: Write failing handler tests**

Add to `apps/mcp/src/tools.test.ts`:

```ts
it("imports an edit-decision file into the editor-control session", async () => {
  const root = await mkdtemp(join(tmpdir(), "opencut-mcp-"));
  const editDecisionPath = await writeJson(root, "edit-decision.json", validEditDecision());
  const mediaInventoryPath = await writeJson(root, "media-inventory.json", {
    schema_version: "opencut.media-inventory.v1",
    root,
    summary: { video: 1, image: 0, audio: 0, other: 0 },
    assets: [{ path: "clip.mp4", type: "video", sha256: "abc123" }],
  });
  const handlers = createOpenCutMcpToolHandlers();

  const response = await handlers.importTimeline({ editDecisionPath, mediaInventoryPath });

  expect(response.structuredContent).toMatchObject({
    loaded: true,
    projectTitle: "Launch reel",
    trackCount: 1,
    itemCount: 1,
  });
});

it("returns timeline state after import and can select an item", async () => {
  const root = await mkdtemp(join(tmpdir(), "opencut-mcp-"));
  const editDecisionPath = await writeJson(root, "edit-decision.json", validEditDecision());
  const handlers = createOpenCutMcpToolHandlers();
  await handlers.importTimeline({ editDecisionPath });

  const selected = await handlers.selectTimelineItem({ itemId: "hook" });
  const state = await handlers.getTimelineState();

  expect(selected.structuredContent).toMatchObject({ loaded: true, selectedItemId: "hook" });
  expect(state.content[0].text).toContain("Project: Launch reel");
});

it("updates timeline item timing through the control session", async () => {
  const root = await mkdtemp(join(tmpdir(), "opencut-mcp-"));
  const editDecisionPath = await writeJson(root, "edit-decision.json", validEditDecision());
  const handlers = createOpenCutMcpToolHandlers();
  await handlers.importTimeline({ editDecisionPath });

  const response = await handlers.updateTimelineItemTiming({
    itemId: "hook",
    start: 1,
    duration: 5,
    sourceIn: 2,
    sourceOut: 7,
  });

  expect(response.structuredContent).toMatchObject({ loaded: true, selectedItemId: "hook" });
  const payload = response.structuredContent as { timeline: { tracks: Array<{ items: Array<{ id: string; start: number }> }> } };
  expect(payload.timeline.tracks[0].items[0]).toMatchObject({ id: "hook", start: 1, duration: 5 });
});
```

- [ ] **Step 2: Write failing server registration tests**

Update `apps/mcp/src/server.test.ts` expectation by extending `OPENCUT_MCP_TOOL_NAMES` through production code. The test remains:

```ts
expect(registerTool.mock.calls.map((call) => call[0])).toEqual(OPENCUT_MCP_TOOL_NAMES);
```

Expected new names:

```ts
[
  "opencut_get_capabilities",
  "opencut_validate_edit_decision",
  "opencut_summarize_edit_decision",
  "opencut_import_timeline",
  "opencut_get_timeline_state",
  "opencut_select_timeline_item",
  "opencut_update_timeline_item_timing",
]
```

- [ ] **Step 3: Run failing Task 3 tests**

Run: `cd apps/mcp && bun run test src/tools.test.ts src/server.test.ts`

Expected: FAIL because handler and server tool names do not exist.

- [ ] **Step 4: Implement handler methods**

Modify `apps/mcp/src/tools.ts`:

```ts
import { OpenCutEditorSession, summarizeTimelineState } from "./editorSession";
import { importTimeline as importEditDecisionTimeline } from "./timelineImport";
```

Extend `ToolHandlerDeps`:

```ts
type ToolHandlerDeps = {
  readTextFile?: (path: string) => Promise<string>;
  editorSession?: OpenCutEditorSession;
};
```

Inside `createOpenCutMcpToolHandlers`, initialize:

```ts
const editorSession = deps.editorSession ?? new OpenCutEditorSession();
```

Add methods:

```ts
async importTimeline(input: ValidateEditDecisionInput): Promise<McpTextResponse> {
  const editDecision = await readJson(readTextFile, input.editDecisionPath, "edit decision");
  const mediaInventory = input.mediaInventoryPath
    ? await readJson(readTextFile, input.mediaInventoryPath, "media inventory")
    : undefined;
  const timeline = importEditDecisionTimeline(editDecision, mediaInventory);
  return jsonResponse(editorSession.load(timeline, input));
},

async getTimelineState(): Promise<McpTextResponse> {
  const state = editorSession.getState();
  const response = textResponse(summarizeTimelineState(state));
  response.structuredContent = state;
  return response;
},

async selectTimelineItem(input: { itemId: string }): Promise<McpTextResponse> {
  return jsonResponse(editorSession.selectItem(input.itemId));
},

async updateTimelineItemTiming(input: UpdateTimelineItemTimingInput): Promise<McpTextResponse> {
  return jsonResponse(editorSession.updateItemTiming(input.itemId, input));
},
```

Define `UpdateTimelineItemTimingInput` near existing input types.

- [ ] **Step 5: Register MCP tools**

Modify `apps/mcp/src/server.ts`:

```ts
export const OPENCUT_MCP_TOOL_NAMES = [
  "opencut_get_capabilities",
  "opencut_validate_edit_decision",
  "opencut_summarize_edit_decision",
  "opencut_import_timeline",
  "opencut_get_timeline_state",
  "opencut_select_timeline_item",
  "opencut_update_timeline_item_timing",
] as const;
```

Add schemas:

```ts
const itemIdSchema = z.string().min(1).describe("Timeline item id.");
const optionalNumberSchema = z.number().finite().optional();
```

Register the four new tools with `openWorldHint: false`. Mark `opencut_get_timeline_state` read-only and the other control tools not read-only.

- [ ] **Step 6: Extend stdio integration test**

In `apps/mcp/src/server.integration.test.ts`, after validation succeeds, call:

```ts
const imported = await client.callTool({
  name: "opencut_import_timeline",
  arguments: { editDecisionPath, mediaInventoryPath },
});
expect(imported.structuredContent).toMatchObject({ loaded: true, projectTitle: "Client smoke test" });

const state = await client.callTool({
  name: "opencut_get_timeline_state",
  arguments: {},
});
expect(state.structuredContent).toMatchObject({ loaded: true, projectTitle: "Client smoke test" });
```

- [ ] **Step 7: Run Task 3 tests**

Run: `cd apps/mcp && bun run test src/tools.test.ts src/server.test.ts src/server.integration.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit Task 3**

```bash
git add apps/mcp/src/tools.ts apps/mcp/src/tools.test.ts apps/mcp/src/server.ts apps/mcp/src/server.test.ts apps/mcp/src/server.integration.test.ts
git commit -m "feat: expose OpenCut timeline control tools"
```

## Task 4: Headless `ffmpeg` Render Adapter

**Files:**
- Create: `apps/mcp/src/render/ffmpeg.ts`
- Create: `apps/mcp/src/render/ffmpeg.test.ts`
- Modify: `apps/mcp/src/editDecision.ts`

**Interfaces:**
- Consumes: `ImportedTimeline`
- Produces:
  - `type FfmpegRenderOptions`
  - `type FfmpegCommandStep`
  - `type FfmpegRenderPlan`
  - `class FfmpegRenderError extends Error`
  - `function buildFfmpegRenderPlan(timeline: ImportedTimeline, options: FfmpegRenderOptions): FfmpegRenderPlan`
  - `function renderTimelineWithFfmpeg(timeline: ImportedTimeline, options: FfmpegRenderOptions & FfmpegRuntimeDeps): Promise<FfmpegRenderResult>`

- [ ] **Step 1: Write failing render adapter tests**

Create `apps/mcp/src/render/ffmpeg.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { FfmpegRenderError, buildFfmpegRenderPlan } from "./ffmpeg";
import type { ImportedTimeline } from "../timelineImport";

function timeline(): ImportedTimeline {
  return {
    project: { title: "Render test", aspectRatio: "9:16", targetDurationSeconds: 2, language: "zh-TW" },
    durationSeconds: 2,
    fps: 30,
    width: 1080,
    height: 1920,
    assets: [
      { path: "media/a.mp4", type: "video" },
      { path: "media/b.jpg", type: "image" },
    ],
    tracks: [
      {
        id: "v1",
        type: "video",
        items: [
          {
            id: "clip",
            trackId: "v1",
            trackType: "video",
            assetPath: "media/a.mp4",
            assetType: "video",
            start: 0,
            duration: 1,
            sourceIn: 0.5,
            sourceOut: 1.5,
            rationale: "Trim.",
          },
          {
            id: "still",
            trackId: "v1",
            trackType: "video",
            assetPath: "media/b.jpg",
            assetType: "image",
            start: 1,
            duration: 1,
            sourceIn: 0,
            sourceOut: 1,
            rationale: "Still.",
          },
        ],
      },
    ],
    warnings: [],
  };
}

describe("buildFfmpegRenderPlan", () => {
  it("builds segment commands and a concat command without shell interpolation", () => {
    const plan = buildFfmpegRenderPlan(timeline(), {
      mediaRoot: "/tmp/project",
      workDir: "/tmp/project/.ai-edits/render-work",
      outputPath: "/tmp/project/.ai-edits/preview/output.mp4",
    });

    expect(plan.steps).toHaveLength(3);
    expect(plan.steps[0]).toMatchObject({ command: "ffmpeg", outputPath: "/tmp/project/.ai-edits/render-work/segment-000.mp4" });
    expect(plan.steps[0].args).toContain("/tmp/project/media/a.mp4");
    expect(plan.steps[0].args).toContain("-ss");
    expect(plan.steps[0].args).toContain("0.5");
    expect(plan.steps[1].args).toContain("-loop");
    expect(plan.steps[2].args).toEqual(expect.arrayContaining(["-f", "concat", "-safe", "0"]));
    expect(plan.concatFilePath).toBe("/tmp/project/.ai-edits/render-work/concat.txt");
    expect(plan.outputPath).toBe("/tmp/project/.ai-edits/preview/output.mp4");
  });

  it("rejects timelines without a visual video or image track", () => {
    const invalid = { ...timeline(), tracks: [{ id: "a1", type: "audio", items: [] }] };

    expect(() => buildFfmpegRenderPlan(invalid, {
      mediaRoot: "/tmp/project",
      workDir: "/tmp/project/.ai-edits/render-work",
      outputPath: "/tmp/project/.ai-edits/preview/output.mp4",
    })).toThrow(FfmpegRenderError);
  });

  it("rejects output paths outside the requested work tree", () => {
    expect(() => buildFfmpegRenderPlan(timeline(), {
      mediaRoot: "/tmp/project",
      workDir: "/tmp/project/.ai-edits/render-work",
      outputPath: "/tmp/project/../escape.mp4",
    })).toThrow("outputPath must stay within mediaRoot or .ai-edits");
  });
});
```

- [ ] **Step 2: Run the failing render tests**

Run: `cd apps/mcp && bun run test src/render/ffmpeg.test.ts`

Expected: FAIL because `./ffmpeg` does not exist.

- [ ] **Step 3: Implement render plan generation**

Create `apps/mcp/src/render/ffmpeg.ts`:

```ts
import { dirname, join, resolve } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { execFile as execFileCallback } from "node:child_process";

import type { ImportedTimeline, ImportedTimelineItem } from "../timelineImport";

const execFile = promisify(execFileCallback);

export type FfmpegCommandStep = {
  command: "ffmpeg";
  args: string[];
  outputPath: string;
};

export type FfmpegRenderPlan = {
  concatFilePath: string;
  concatFileContent: string;
  outputPath: string;
  steps: FfmpegCommandStep[];
};

export type FfmpegRenderOptions = {
  mediaRoot: string;
  workDir: string;
  outputPath: string;
};

export type FfmpegRenderResult = {
  outputPath: string;
  commandCount: number;
};

export type FfmpegRuntimeDeps = {
  execFile?: (command: string, args: string[]) => Promise<unknown>;
  mkdir?: (path: string, options: { recursive: true }) => Promise<unknown>;
  writeFile?: (path: string, content: string, encoding: "utf8") => Promise<unknown>;
};

export class FfmpegRenderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FfmpegRenderError";
  }
}
```

Implement:

```ts
export function buildFfmpegRenderPlan(timeline: ImportedTimeline, options: FfmpegRenderOptions): FfmpegRenderPlan {
  const mediaRoot = resolve(options.mediaRoot);
  const workDir = resolve(options.workDir);
  const outputPath = resolve(options.outputPath);
  assertInside(mediaRoot, workDir, "workDir must stay within mediaRoot or .ai-edits");
  assertInside(mediaRoot, outputPath, "outputPath must stay within mediaRoot or .ai-edits");

  const visualItems = primaryVisualItems(timeline);
  if (visualItems.length === 0) {
    throw new FfmpegRenderError("timeline must contain at least one video or image item to render");
  }

  const scaleFilter = `scale=${timeline.width}:${timeline.height}:force_original_aspect_ratio=decrease,pad=${timeline.width}:${timeline.height}:(ow-iw)/2:(oh-ih)/2,setsar=1`;
  const steps = visualItems.map((item, index) => {
    const segmentPath = join(workDir, `segment-${String(index).padStart(3, "0")}.mp4`);
    const inputPath = resolve(mediaRoot, item.assetPath);
    assertInside(mediaRoot, inputPath, `asset path escapes mediaRoot: ${item.assetPath}`);
    const inputArgs =
      item.assetType === "image"
        ? ["-loop", "1", "-t", formatSeconds(item.duration), "-i", inputPath]
        : ["-ss", formatSeconds(item.sourceIn), "-t", formatSeconds(item.duration), "-i", inputPath];
    return {
      command: "ffmpeg" as const,
      outputPath: segmentPath,
      args: [
        "-y",
        ...inputArgs,
        "-f",
        "lavfi",
        "-t",
        formatSeconds(item.duration),
        "-i",
        "anullsrc=channel_layout=stereo:sample_rate=48000",
        "-map",
        "0:v:0",
        "-map",
        "1:a:0",
        "-vf",
        scaleFilter,
        "-r",
        String(timeline.fps),
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-shortest",
        segmentPath,
      ],
    };
  });

  const concatFilePath = join(workDir, "concat.txt");
  const concatFileContent = steps.map((step) => `file '${step.outputPath.replaceAll("'", "'\\''")}'`).join("\n") + "\n";
  steps.push({
    command: "ffmpeg",
    outputPath,
    args: ["-y", "-f", "concat", "-safe", "0", "-i", concatFilePath, "-c", "copy", outputPath],
  });
  return { concatFilePath, concatFileContent, outputPath, steps };
}
```

Add helpers:

```ts
function primaryVisualItems(timeline: ImportedTimeline): ImportedTimelineItem[] {
  const track = timeline.tracks.find((candidate) => candidate.type === "video" || candidate.type === "image");
  return track?.items.filter((item) => item.assetType === "video" || item.assetType === "image") ?? [];
}

function assertInside(root: string, value: string, message: string): void {
  if (value !== root && !value.startsWith(`${root}/`)) {
    throw new FfmpegRenderError(message);
  }
}

function formatSeconds(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}
```

- [ ] **Step 4: Implement render execution wrapper**

Add:

```ts
export async function renderTimelineWithFfmpeg(
  timeline: ImportedTimeline,
  options: FfmpegRenderOptions & FfmpegRuntimeDeps,
): Promise<FfmpegRenderResult> {
  const plan = buildFfmpegRenderPlan(timeline, options);
  const run = options.execFile ?? ((command, args) => execFile(command, args));
  const makeDir = options.mkdir ?? mkdir;
  const writeText = options.writeFile ?? writeFile;
  await makeDir(options.workDir, { recursive: true });
  await makeDir(dirname(options.outputPath), { recursive: true });
  await writeText(plan.concatFilePath, plan.concatFileContent, "utf8");
  for (const step of plan.steps) {
    await run(step.command, step.args);
  }
  return { outputPath: plan.outputPath, commandCount: plan.steps.length };
}
```

- [ ] **Step 5: Update capabilities**

Modify `apps/mcp/src/editDecision.ts` so `execution.ffmpegRenderAdapter` is `true` and `execution.headlessRender` remains `false` until the MCP export tool is wired and verified.

- [ ] **Step 6: Run Task 4 tests**

Run: `cd apps/mcp && bun run test src/render/ffmpeg.test.ts src/editDecision.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit Task 4**

```bash
git add apps/mcp/src/render/ffmpeg.ts apps/mcp/src/render/ffmpeg.test.ts apps/mcp/src/editDecision.ts apps/mcp/src/editDecision.test.ts
git commit -m "feat: add headless ffmpeg render adapter"
```

## Task 5: MCP Export Tool And End-To-End Video Output

**Files:**
- Create: `apps/mcp/src/render/ffmpeg.integration.test.ts`
- Modify: `apps/mcp/src/tools.ts`
- Modify: `apps/mcp/src/tools.test.ts`
- Modify: `apps/mcp/src/server.ts`
- Modify: `apps/mcp/src/server.test.ts`
- Modify: `apps/mcp/src/server.integration.test.ts`
- Modify: `apps/mcp/src/editDecision.ts`
- Modify: `apps/mcp/README.md`

**Interfaces:**
- Consumes:
  - `OpenCutEditorSession.getState()`
  - `renderTimelineWithFfmpeg(timeline, options)`
  - `buildFfmpegRenderPlan(timeline, options)`
- Produces:
  - Handler method `exportTimeline(input: { mediaRoot: string; workDir: string; outputPath: string; dryRun?: boolean }): Promise<McpTextResponse>`
  - MCP tool `opencut_export_timeline`

- [ ] **Step 1: Write failing export handler tests**

Add to `apps/mcp/src/tools.test.ts`:

```ts
it("dry-runs export for the currently loaded timeline", async () => {
  const root = await mkdtemp(join(tmpdir(), "opencut-mcp-"));
  const editDecisionPath = await writeJson(root, "edit-decision.json", validEditDecision());
  const handlers = createOpenCutMcpToolHandlers();
  await handlers.importTimeline({ editDecisionPath });

  const response = await handlers.exportTimeline({
    mediaRoot: root,
    workDir: join(root, ".ai-edits", "render-work"),
    outputPath: join(root, ".ai-edits", "preview", "output.mp4"),
    dryRun: true,
  });

  expect(response.structuredContent).toMatchObject({
    outputPath: join(root, ".ai-edits", "preview", "output.mp4"),
    dryRun: true,
  });
  expect(response.content[0].text).toContain("ffmpeg command plan");
});

it("rejects export when no timeline is loaded", async () => {
  const handlers = createOpenCutMcpToolHandlers();

  await expect(handlers.exportTimeline({
    mediaRoot: "/tmp/project",
    workDir: "/tmp/project/.ai-edits/render-work",
    outputPath: "/tmp/project/.ai-edits/preview/output.mp4",
  })).rejects.toThrow("no timeline is loaded");
});
```

- [ ] **Step 2: Write failing integration render test**

Create `apps/mcp/src/render/ffmpeg.integration.test.ts`:

```ts
import { access, mkdtemp, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { execFile as execFileCallback } from "node:child_process";
import { describe, expect, it } from "vitest";

import { renderTimelineWithFfmpeg } from "./ffmpeg";
import type { ImportedTimeline } from "../timelineImport";

const execFile = promisify(execFileCallback);

async function hasFfmpeg(): Promise<boolean> {
  try {
    await execFile("ffmpeg", ["-version"]);
    return true;
  } catch {
    return false;
  }
}

describe("renderTimelineWithFfmpeg integration", () => {
  it("renders a real mp4 from generated local fixture media when ffmpeg is installed", async () => {
    if (!(await hasFfmpeg())) {
      console.warn("Skipping real ffmpeg render because ffmpeg is not installed.");
      return;
    }

    const root = await mkdtemp(join(tmpdir(), "opencut-render-"));
    const mediaPath = join(root, "clip.mp4");
    await execFile("ffmpeg", [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "color=c=red:s=320x180:d=1",
      "-f",
      "lavfi",
      "-i",
      "anullsrc=channel_layout=stereo:sample_rate=48000",
      "-shortest",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      mediaPath,
    ]);

    const timeline: ImportedTimeline = {
      project: { title: "Real render", aspectRatio: "16:9", targetDurationSeconds: 1, language: "zh-TW" },
      durationSeconds: 1,
      fps: 24,
      width: 320,
      height: 180,
      assets: [{ path: "clip.mp4", type: "video" }],
      tracks: [
        {
          id: "v1",
          type: "video",
          items: [
            {
              id: "clip",
              trackId: "v1",
              trackType: "video",
              assetPath: "clip.mp4",
              assetType: "video",
              start: 0,
              duration: 1,
              sourceIn: 0,
              sourceOut: 1,
              rationale: "Fixture.",
            },
          ],
        },
      ],
      warnings: [],
    };
    const outputPath = join(root, ".ai-edits", "preview", "output.mp4");

    const result = await renderTimelineWithFfmpeg(timeline, {
      mediaRoot: root,
      workDir: join(root, ".ai-edits", "render-work"),
      outputPath,
    });

    await access(result.outputPath);
    expect((await stat(result.outputPath)).size).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 3: Run failing Task 5 tests**

Run: `cd apps/mcp && bun run test src/tools.test.ts src/render/ffmpeg.integration.test.ts`

Expected: FAIL because `exportTimeline` is not implemented. The integration render test may pass or skip depending on local `ffmpeg`, but the handler test must fail first.

- [ ] **Step 4: Implement export handler**

Modify `apps/mcp/src/tools.ts`:

```ts
import { buildFfmpegRenderPlan, renderTimelineWithFfmpeg } from "./render/ffmpeg";
```

Add input type:

```ts
type ExportTimelineInput = {
  mediaRoot: string;
  workDir: string;
  outputPath: string;
  dryRun?: boolean;
};
```

Add method:

```ts
async exportTimeline(input: ExportTimelineInput): Promise<McpTextResponse> {
  const state = editorSession.getState();
  if (!state.loaded) {
    throw new Error("no timeline is loaded");
  }
  if (input.dryRun === true) {
    const plan = buildFfmpegRenderPlan(state.timeline, input);
    return jsonResponse({
      dryRun: true,
      outputPath: plan.outputPath,
      commandCount: plan.steps.length,
      commands: plan.steps.map((step) => ({ command: step.command, args: step.args })),
    });
  }
  const result = await renderTimelineWithFfmpeg(state.timeline, input);
  return jsonResponse({
    dryRun: false,
    outputPath: result.outputPath,
    commandCount: result.commandCount,
  });
},
```

Adjust the dry-run text response to include the phrase `ffmpeg command plan` by wrapping the JSON response text if needed.

- [ ] **Step 5: Register export MCP tool**

Modify `apps/mcp/src/server.ts`:

```ts
"opencut_export_timeline",
```

Add schema:

```ts
const filesystemPathSchema = z.string().min(1);
```

Register:

```ts
server.registerTool(
  "opencut_export_timeline",
  {
    title: "Export OpenCut timeline",
    description: "Render the loaded edit-decision timeline through the local ffmpeg adapter.",
    inputSchema: {
      mediaRoot: filesystemPathSchema.describe("Root folder used to resolve relative asset paths."),
      workDir: filesystemPathSchema.describe("Temporary render work directory."),
      outputPath: filesystemPathSchema.describe("Final mp4 output path."),
      dryRun: z.boolean().optional().describe("Return the ffmpeg command plan without running ffmpeg."),
    },
    annotations: {
      readOnlyHint: false,
      openWorldHint: false,
    },
  },
  async (args) =>
    handlers.exportTimeline({
      mediaRoot: String(args.mediaRoot),
      workDir: String(args.workDir),
      outputPath: String(args.outputPath),
      dryRun: typeof args.dryRun === "boolean" ? args.dryRun : undefined,
    }),
);
```

- [ ] **Step 6: Update capabilities**

Modify `apps/mcp/src/editDecision.ts`:

```ts
headlessRender: true,
ffmpegRenderAdapter: true,
```

Keep caveat text explicit:

```ts
"This server can import, control, and ffmpeg-render edit-decision timelines. Native OpenCut editor import/render remains unavailable until OpenCut exposes a real editor API, plugin API, MCP surface, or headless renderer.",
```

- [ ] **Step 7: Update README**

Modify `apps/mcp/README.md` tools list to include:

```md
- `opencut_import_timeline` — loads an edit-decision package into an in-memory control session.
- `opencut_get_timeline_state` — returns the loaded timeline state.
- `opencut_select_timeline_item` — selects an item in the loaded timeline.
- `opencut_update_timeline_item_timing` — updates basic item timing and trim metadata.
- `opencut_export_timeline` — renders the loaded timeline through local `ffmpeg`, or returns a dry-run command plan.
```

Add limitation:

```md
The export tool is an initial local `ffmpeg` adapter for edit-decision timelines. It is not proof of native OpenCut editor import or native OpenCut headless rendering.
```

- [ ] **Step 8: Run Task 5 tests**

Run: `cd apps/mcp && bun run test src/tools.test.ts src/server.test.ts src/server.integration.test.ts src/render/ffmpeg.integration.test.ts`

Expected: PASS. If `ffmpeg` is not installed, the integration test logs a skip message and returns without rendering.

- [ ] **Step 9: Commit Task 5**

```bash
git add apps/mcp/src/tools.ts apps/mcp/src/tools.test.ts apps/mcp/src/server.ts apps/mcp/src/server.test.ts apps/mcp/src/server.integration.test.ts apps/mcp/src/editDecision.ts apps/mcp/src/render/ffmpeg.integration.test.ts apps/mcp/README.md
git commit -m "feat: export OpenCut timelines with ffmpeg"
```

## Final Verification

- [ ] **Step 1: Run MCP tests**

Run: `cd apps/mcp && bun run test`

Expected: all test files pass.

- [ ] **Step 2: Run MCP build**

Run: `cd apps/mcp && bun run build`

Expected: `tsc -p tsconfig.json` exits 0.

- [ ] **Step 3: Run root Moon verification**

Run: `moon run mcp:test`

Expected: MCP test task exits 0.

Run: `moon run mcp:build`

Expected: MCP build task exits 0.

- [ ] **Step 4: Inspect final status**

Run:

```bash
git status --short --branch
git log --oneline -5
```

Expected: only intentional files are changed or committed; branch remains ahead of `origin/main` and no unrelated user changes were reverted.

## Plan Self-Review

- Spec coverage: Task 1 covers timeline import; Task 2 covers editor control state; Task 3 exposes MCP control; Task 4 covers headless render adapter; Task 5 covers actual video export and docs.
- Incomplete-marker scan: no intentionally unfinished implementation markers are left in this plan.
- Type consistency: `ImportedTimeline`, `OpenCutEditorSession`, `buildFfmpegRenderPlan`, and `renderTimelineWithFfmpeg` are defined before downstream tasks consume them.
