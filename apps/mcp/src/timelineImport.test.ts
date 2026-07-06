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

    expect(() => importTimeline(plan)).toThrow(
      "asset path must be relative and stay within the media root: ../secret.mp4",
    );
  });

  it("rejects unsupported executable track types", () => {
    const plan = validEditDecision();
    plan.timeline.tracks[0].type = "overlay";

    expect(() => importTimeline(plan)).toThrow("track 'v1' has unsupported executable type: overlay");
  });
});
