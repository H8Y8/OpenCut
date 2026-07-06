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
