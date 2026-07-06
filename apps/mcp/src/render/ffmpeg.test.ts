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
    subtitles: [],
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

function timelineWithSubtitles(): ImportedTimeline {
  return {
    ...timeline(),
    subtitles: [{ id: "cap-1", start: 0.5, duration: 1, text: "Hello\nWorld" }],
  };
}

function timelineWithAudioAndSubtitles(): ImportedTimeline {
  return {
    ...timelineWithAudioTrack(),
    subtitles: [{ id: "cap-1", start: 0.5, duration: 1, text: "Hello\nWorld" }],
  };
}

function timelineWithVisualGap(): ImportedTimeline {
  const base = timeline();
  return {
    ...base,
    durationSeconds: 3,
    project: { ...base.project, targetDurationSeconds: 3 },
    tracks: [
      {
        ...base.tracks[0],
        items: [
          base.tracks[0].items[0],
          {
            ...base.tracks[0].items[1],
            start: 2,
            sourceOut: 1,
          },
        ],
      },
    ],
  };
}

function timelineWithVisualOverlap(): ImportedTimeline {
  const base = timeline();
  return {
    ...base,
    tracks: [
      {
        ...base.tracks[0],
        items: [
          base.tracks[0].items[0],
          {
            ...base.tracks[0].items[1],
            start: 0.5,
          },
        ],
      },
    ],
  };
}

function timelineWithTailVisualGap(): ImportedTimeline {
  const base = timeline();
  return {
    ...base,
    durationSeconds: 3,
    project: { ...base.project, targetDurationSeconds: 3 },
  };
}

function timelineWithSeparateVisualTracks(): ImportedTimeline {
  const base = timeline();
  return {
    ...base,
    tracks: [
      {
        ...base.tracks[0],
        items: [base.tracks[0].items[0]],
      },
      {
        id: "i1",
        type: "image",
        items: [{ ...base.tracks[0].items[1], trackId: "i1", trackType: "image" }],
      },
    ],
  };
}

function timelineWithOverlappingVisualTracks(): ImportedTimeline {
  const base = timelineWithSeparateVisualTracks();
  return {
    ...base,
    tracks: [
      base.tracks[0],
      {
        ...base.tracks[1],
        items: [{ ...base.tracks[1].items[0], start: 0.5 }],
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

  it("renders sequential visual items from separate video and image tracks", () => {
    const plan = buildFfmpegRenderPlan(timelineWithSeparateVisualTracks(), {
      mediaRoot: "/tmp/project",
      workDir: "/tmp/project/.ai-edits/render-work",
      outputPath: "/tmp/project/.ai-edits/preview/output.mp4",
    });

    expect(plan.steps).toHaveLength(3);
    expect(plan.steps[0]).toMatchObject({
      command: "ffmpeg",
      outputPath: "/tmp/project/.ai-edits/render-work/segment-000.mp4",
    });
    expect(plan.steps[1]).toMatchObject({
      command: "ffmpeg",
      outputPath: "/tmp/project/.ai-edits/render-work/segment-001.mp4",
    });
    expect(plan.steps[1].args).toContain("/tmp/project/media/b.jpg");
    expect(plan.concatFileContent).toContain("segment-000.mp4");
    expect(plan.concatFileContent).toContain("segment-001.mp4");
  });

  it("rejects overlapping visual items across separate visual tracks", () => {
    expect(() =>
      buildFfmpegRenderPlan(timelineWithOverlappingVisualTracks(), {
        mediaRoot: "/tmp/project",
        workDir: "/tmp/project/.ai-edits/render-work",
        outputPath: "/tmp/project/.ai-edits/preview/output.mp4",
      }),
    ).toThrow("visual items must not overlap");
  });

  it("preserves visual timeline gaps as black silent segments", () => {
    const plan = buildFfmpegRenderPlan(timelineWithVisualGap(), {
      mediaRoot: "/tmp/project",
      workDir: "/tmp/project/.ai-edits/render-work",
      outputPath: "/tmp/project/.ai-edits/preview/output.mp4",
    });

    expect(plan.steps).toHaveLength(4);
    expect(plan.steps[1]).toMatchObject({
      command: "ffmpeg",
      outputPath: "/tmp/project/.ai-edits/render-work/gap-001.mp4",
    });
    expect(plan.steps[1].args).toEqual(
      expect.arrayContaining([
        "-f",
        "lavfi",
        "-t",
        "1",
        "-i",
        "color=c=black:s=1080x1920:r=30",
        "-i",
        "anullsrc=channel_layout=stereo:sample_rate=48000",
      ]),
    );
    expect(plan.steps[2]).toMatchObject({
      command: "ffmpeg",
      outputPath: "/tmp/project/.ai-edits/render-work/segment-002.mp4",
    });
    expect(plan.concatFileContent).toContain("segment-000.mp4");
    expect(plan.concatFileContent).toContain("gap-001.mp4");
    expect(plan.concatFileContent).toContain("segment-002.mp4");
  });

  it("preserves tail visual gaps through the declared timeline duration", () => {
    const plan = buildFfmpegRenderPlan(timelineWithTailVisualGap(), {
      mediaRoot: "/tmp/project",
      workDir: "/tmp/project/.ai-edits/render-work",
      outputPath: "/tmp/project/.ai-edits/preview/output.mp4",
    });

    expect(plan.steps).toHaveLength(4);
    expect(plan.steps[2]).toMatchObject({
      command: "ffmpeg",
      outputPath: "/tmp/project/.ai-edits/render-work/gap-002.mp4",
    });
    expect(plan.steps[2].args).toEqual(expect.arrayContaining(["-t", "1"]));
    expect(plan.concatFileContent).toContain("gap-002.mp4");
  });

  it("rejects overlapping visual timeline items", () => {
    expect(() =>
      buildFfmpegRenderPlan(timelineWithVisualOverlap(), {
        mediaRoot: "/tmp/project",
        workDir: "/tmp/project/.ai-edits/render-work",
        outputPath: "/tmp/project/.ai-edits/preview/output.mp4",
      }),
    ).toThrow("visual items must not overlap");
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

  it("builds an SRT file and burns subtitle cues into the final output", () => {
    const plan = buildFfmpegRenderPlan(timelineWithSubtitles(), {
      mediaRoot: "/tmp/project",
      workDir: "/tmp/project/.ai-edits/render-work",
      outputPath: "/tmp/project/.ai-edits/preview/output.mp4",
    }) as ReturnType<typeof buildFfmpegRenderPlan> & {
      subtitleFilePath?: string;
      subtitleFileContent?: string;
    };

    expect(plan.subtitleFilePath).toBe("/tmp/project/.ai-edits/render-work/subtitles.srt");
    expect(plan.subtitleFileContent).toContain(
      ["1", "00:00:00,500 --> 00:00:01,500", "Hello", "World"].join("\n"),
    );
    expect(plan.steps).toHaveLength(4);
    expect(plan.steps[2]).toMatchObject({
      command: "ffmpeg",
      outputPath: "/tmp/project/.ai-edits/render-work/visual-concat.mp4",
    });
    expect(plan.steps[3]).toMatchObject({
      command: "ffmpeg",
      outputPath: "/tmp/project/.ai-edits/preview/output.mp4",
    });
    expect(plan.steps[3].args).toEqual(
      expect.arrayContaining([
        "-i",
        "/tmp/project/.ai-edits/render-work/visual-concat.mp4",
        "-vf",
        "subtitles=/tmp/project/.ai-edits/render-work/subtitles.srt",
        "-c:a",
        "copy",
      ]),
    );
  });

  it("burns subtitle cues after explicit audio track mixing", () => {
    const plan = buildFfmpegRenderPlan(timelineWithAudioAndSubtitles(), {
      mediaRoot: "/tmp/project",
      workDir: "/tmp/project/.ai-edits/render-work",
      outputPath: "/tmp/project/.ai-edits/preview/output.mp4",
    });

    expect(plan.steps).toHaveLength(6);
    expect(plan.steps[4]).toMatchObject({
      command: "ffmpeg",
      outputPath: "/tmp/project/.ai-edits/render-work/audio-mix.mp4",
    });
    expect(plan.steps[5]).toMatchObject({
      command: "ffmpeg",
      outputPath: "/tmp/project/.ai-edits/preview/output.mp4",
    });
    expect(plan.steps[5].args).toEqual(
      expect.arrayContaining([
        "-i",
        "/tmp/project/.ai-edits/render-work/audio-mix.mp4",
        "-vf",
        "subtitles=/tmp/project/.ai-edits/render-work/subtitles.srt",
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

  it("writes subtitle files before executing render steps", async () => {
    const writes: Array<{ path: string; content: string }> = [];

    await renderTimelineWithFfmpeg(timelineWithSubtitles(), {
      mediaRoot: "/tmp/project",
      workDir: "/tmp/project/.ai-edits/render-work",
      outputPath: "/tmp/project/.ai-edits/preview/output.mp4",
      sourceAudioByAssetPath: {
        "media/a.mp4": false,
      },
      execFile: async () => ({}),
      mkdir: async () => {},
      writeFile: async (path, content) => {
        writes.push({ path, content });
      },
    });

    expect(writes.map((write) => write.path).slice(0, 2)).toEqual([
      "/tmp/project/.ai-edits/render-work/concat.txt",
      "/tmp/project/.ai-edits/render-work/subtitles.srt",
    ]);
    expect(writes[1].content).toContain("00:00:00,500 --> 00:00:01,500");
  });

  it("writes a render manifest after successful command execution", async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const writes: Array<{ path: string; content: string }> = [];

    const result = await renderTimelineWithFfmpeg(timelineWithSubtitles(), {
      mediaRoot: "/tmp/project",
      workDir: "/tmp/project/.ai-edits/render-work",
      outputPath: "/tmp/project/.ai-edits/preview/output.mp4",
      sourceAudioByAssetPath: {
        "media/a.mp4": false,
      },
      execFile: async (command, args) => {
        calls.push({ command, args });
        return {};
      },
      mkdir: async () => {},
      writeFile: async (path, content) => {
        writes.push({ path, content });
      },
    });

    expect(result).toMatchObject({
      outputPath: "/tmp/project/.ai-edits/preview/output.mp4",
      manifestPath: "/tmp/project/.ai-edits/manifests/render-manifest.json",
    });
    expect(writes.at(-1)?.path).toBe("/tmp/project/.ai-edits/manifests/render-manifest.json");
    const manifest = JSON.parse(writes.at(-1)?.content ?? "{}");
    expect(manifest).toMatchObject({
      schemaVersion: "opencut.ffmpeg-render-manifest.v1",
      renderer: "ffmpeg",
      mediaRoot: "/tmp/project",
      workDir: "/tmp/project/.ai-edits/render-work",
      outputPath: "/tmp/project/.ai-edits/preview/output.mp4",
      commandCount: 4,
      generatedFiles: {
        concatFilePath: "/tmp/project/.ai-edits/render-work/concat.txt",
        subtitleFilePath: "/tmp/project/.ai-edits/render-work/subtitles.srt",
      },
    });
    expect(manifest.commands).toHaveLength(calls.length);
    expect(manifest.commands[0]).toMatchObject({ index: 0, command: "ffmpeg" });
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
