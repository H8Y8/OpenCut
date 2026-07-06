import { describe, expect, it } from "vitest";

import { FfmpegRenderError, buildFfmpegRenderPlan, renderTimelineWithFfmpeg } from "./ffmpeg";
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

function timelineWithAudioTrack(): ImportedTimeline {
  const base = timeline();
  return {
    ...base,
    assets: [...base.assets, { path: "media/music.wav", type: "audio" }],
    tracks: [
      ...base.tracks,
      {
        id: "a1",
        type: "audio",
        items: [
          {
            id: "music",
            trackId: "a1",
            trackType: "audio",
            assetPath: "media/music.wav",
            assetType: "audio",
            start: 0.5,
            duration: 1.5,
            sourceIn: 2,
            sourceOut: 3.5,
            rationale: "Music bed.",
          },
        ],
      },
    ],
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
    expect(plan.steps[0]).toMatchObject({
      command: "ffmpeg",
      outputPath: "/tmp/project/.ai-edits/render-work/segment-000.mp4",
    });
    expect(plan.steps[0].args).toContain("/tmp/project/media/a.mp4");
    expect(plan.steps[0].args).toContain("-ss");
    expect(plan.steps[0].args).toContain("0.5");
    expect(plan.steps[0].args).toEqual(expect.arrayContaining(["-map", "0:a:0"]));
    expect(plan.steps[0].args).not.toContain("anullsrc=channel_layout=stereo:sample_rate=48000");
    expect(plan.steps[1].args).toContain("-loop");
    expect(plan.steps[1].args).toEqual(expect.arrayContaining(["-map", "1:a:0"]));
    expect(plan.steps[1].args).toContain("anullsrc=channel_layout=stereo:sample_rate=48000");
    expect(plan.steps[2].args).toEqual(expect.arrayContaining(["-f", "concat", "-safe", "0"]));
    expect(plan.concatFilePath).toBe("/tmp/project/.ai-edits/render-work/concat.txt");
    expect(plan.outputPath).toBe("/tmp/project/.ai-edits/preview/output.mp4");
  });

  it("uses silent fallback audio for video assets known to have no source audio", () => {
    const plan = buildFfmpegRenderPlan(timeline(), {
      mediaRoot: "/tmp/project",
      workDir: "/tmp/project/.ai-edits/render-work",
      outputPath: "/tmp/project/.ai-edits/preview/output.mp4",
      sourceAudioByAssetPath: {
        "media/a.mp4": false,
      },
    });

    expect(plan.steps[0].args).toEqual(expect.arrayContaining(["-map", "1:a:0"]));
    expect(plan.steps[0].args).toContain("anullsrc=channel_layout=stereo:sample_rate=48000");
  });

  it("mixes explicit audio track items into the final output timeline", () => {
    const plan = buildFfmpegRenderPlan(timelineWithAudioTrack(), {
      mediaRoot: "/tmp/project",
      workDir: "/tmp/project/.ai-edits/render-work",
      outputPath: "/tmp/project/.ai-edits/preview/output.mp4",
    });

    expect(plan.steps).toHaveLength(5);
    expect(plan.steps[2]).toMatchObject({
      command: "ffmpeg",
      outputPath: "/tmp/project/.ai-edits/render-work/visual-concat.mp4",
    });
    expect(plan.steps[3]).toMatchObject({
      command: "ffmpeg",
      outputPath: "/tmp/project/.ai-edits/render-work/audio-000.m4a",
    });
    expect(plan.steps[3].args).toEqual(expect.arrayContaining(["-ss", "2", "-t", "1.5"]));
    expect(plan.steps[3].args).toContain("/tmp/project/media/music.wav");
    expect(plan.steps[3].args).toEqual(expect.arrayContaining(["-af", "adelay=500:all=1,apad,atrim=0:2"]));
    expect(plan.steps[4]).toMatchObject({
      command: "ffmpeg",
      outputPath: "/tmp/project/.ai-edits/preview/output.mp4",
    });
    expect(plan.steps[4].args).toEqual(
      expect.arrayContaining([
        "-filter_complex",
        "[0:a:0][1:a:0]amix=inputs=2:duration=first:dropout_transition=0[aout]",
        "-map",
        "0:v:0",
        "-map",
        "[aout]",
      ]),
    );
  });

  it("probes video assets before rendering so missing audio falls back to silence", async () => {
    const calls: Array<{ command: string; args: string[] }> = [];

    await renderTimelineWithFfmpeg(timeline(), {
      mediaRoot: "/tmp/project",
      workDir: "/tmp/project/.ai-edits/render-work",
      outputPath: "/tmp/project/.ai-edits/preview/output.mp4",
      execFile: async (command, args) => {
        calls.push({ command, args });
        if (command === "ffprobe") {
          return { stdout: "" };
        }
        return {};
      },
      mkdir: async () => {},
      writeFile: async () => {},
    });

    expect(calls[0]).toMatchObject({
      command: "ffprobe",
      args: expect.arrayContaining(["/tmp/project/media/a.mp4"]),
    });
    const firstRender = calls.find((call) => call.command === "ffmpeg");
    expect(firstRender?.args).toEqual(expect.arrayContaining(["-map", "1:a:0"]));
    expect(firstRender?.args).toContain("anullsrc=channel_layout=stereo:sample_rate=48000");
  });

  it("rejects timelines without a visual video or image track", () => {
    const invalid: ImportedTimeline = { ...timeline(), tracks: [{ id: "a1", type: "audio", items: [] }] };

    expect(() =>
      buildFfmpegRenderPlan(invalid, {
        mediaRoot: "/tmp/project",
        workDir: "/tmp/project/.ai-edits/render-work",
        outputPath: "/tmp/project/.ai-edits/preview/output.mp4",
      }),
    ).toThrow(FfmpegRenderError);
  });

  it("rejects output paths outside the requested work tree", () => {
    expect(() =>
      buildFfmpegRenderPlan(timeline(), {
        mediaRoot: "/tmp/project",
        workDir: "/tmp/project/.ai-edits/render-work",
        outputPath: "/tmp/project/../escape.mp4",
      }),
    ).toThrow("outputPath must stay within mediaRoot or .ai-edits");
  });
});
