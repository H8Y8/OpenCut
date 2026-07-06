import { describe, expect, it } from "vitest";

import {
  getOpenCutMcpCapabilities,
  summarizeEditDecision,
  validateEditDecision,
} from "./editDecision";

function validEditDecision() {
  return {
    schema_version: "opencut.ai-edit-decision.v1",
    project: {
      title: "Launch reel",
      aspect_ratio: "9:16",
      target_duration_seconds: 10,
      language: "zh-TW",
    },
    assets: [
      {
        path: "clip.mp4",
        type: "video",
        sha256: "abc123",
      },
      {
        path: "voice.wav",
        type: "audio",
      },
    ],
    timeline: {
      duration_seconds: 10,
      tracks: [
        {
          id: "v1",
          type: "video",
          items: [
            {
              id: "hook",
              asset_path: "clip.mp4",
              start: 0,
              duration: 4,
              source_in: 2,
              source_out: 6,
              rationale: "Strong opening motion.",
            },
          ],
        },
        {
          id: "a1",
          type: "audio",
          items: [
            {
              id: "voice",
              asset_path: "voice.wav",
              start: 0,
              duration: 10,
              rationale: "Narration bed.",
            },
          ],
        },
      ],
    },
    subtitles: [
      {
        id: "cap-1",
        start: 0,
        duration: 2,
        text: "開場先抓住注意力",
      },
    ],
    rationale: ["Use the strongest motion as the hook."],
  };
}

const validInventory = {
  schema_version: "opencut.media-inventory.v1",
  root: "/media",
  summary: { video: 1, image: 0, audio: 1, other: 0 },
  assets: [
    { path: "clip.mp4", type: "video", sha256: "abc123" },
    { path: "voice.wav", type: "audio", sha256: "def456" },
  ],
};

describe("validateEditDecision", () => {
  it("accepts a structurally valid edit decision and matching inventory", () => {
    const result = validateEditDecision(validEditDecision(), validInventory);

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("rejects timeline items that reference undeclared assets", () => {
    const plan = validEditDecision();
    plan.timeline.tracks[0].items[0].asset_path = "missing.mp4";

    const result = validateEditDecision(plan, validInventory);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      "track 'v1' item[0] references asset_path not listed in assets: 'missing.mp4'",
    );
  });

  it("rejects source assets missing from the media inventory", () => {
    const inventory = {
      ...validInventory,
      assets: [{ path: "other.mp4", type: "video", sha256: "abc123" }],
    };

    const result = validateEditDecision(validEditDecision(), inventory);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("asset 'clip.mp4' is not present in media inventory");
    expect(result.errors).toContain("asset 'voice.wav' is not present in media inventory");
  });
});

describe("summarizeEditDecision", () => {
  it("returns a compact human-readable summary", () => {
    const summary = summarizeEditDecision(validEditDecision());

    expect(summary).toContain("Project: Launch reel");
    expect(summary).toContain("Timeline: 10s, 2 track(s), 2 item(s)");
    expect(summary).toContain("Assets: 2 total (video: 1, audio: 1)");
    expect(summary).toContain("Subtitles: 1 cue(s)");
  });
});

describe("getOpenCutMcpCapabilities", () => {
  it("is honest about the current OpenCut execution surface", () => {
    const capabilities = getOpenCutMcpCapabilities();

    expect(capabilities.execution.openCutNativeImport).toBe(false);
    expect(capabilities.execution.editorApi).toBe(false);
    expect(capabilities.execution.pluginApi).toBe(false);
    expect(capabilities.execution.headlessRender).toBe(true);
    expect(capabilities.execution.ffmpegRenderAdapter).toBe(true);
    expect(capabilities.artifacts).toContain("edit-decision.json");
    expect(capabilities.caveats).toContain(
      "This server can import, control, and ffmpeg-render edit-decision timelines. Native OpenCut editor import/render remains unavailable until OpenCut exposes a real editor API, plugin API, MCP surface, or headless renderer.",
    );
  });
});
