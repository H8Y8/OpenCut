import { execFile as execFileCallback } from "node:child_process";
import { access, mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

import type { ImportedTimeline } from "../timelineImport";
import { renderTimelineWithFfmpeg } from "./ffmpeg";

const execFile = promisify(execFileCallback);

async function hasFfmpeg(): Promise<boolean> {
  try {
    await execFile("ffmpeg", ["-version"]);
    await execFile("ffprobe", ["-version"]);
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
      subtitles: [],
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

  it("renders a real mp4 with an explicit audio track when ffmpeg is installed", async () => {
    if (!(await hasFfmpeg())) {
      console.warn("Skipping explicit audio track render because ffmpeg is not installed.");
      return;
    }

    const root = await mkdtemp(join(tmpdir(), "opencut-render-audio-"));
    await execFile("ffmpeg", [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "color=c=purple:s=320x180:d=1",
      "-an",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      join(root, "clip.mp4"),
    ]);
    await execFile("ffmpeg", [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=660:duration=1",
      "-c:a",
      "aac",
      join(root, "music.m4a"),
    ]);

    const timeline: ImportedTimeline = {
      project: { title: "Audio render", aspectRatio: "16:9", targetDurationSeconds: 1, language: "zh-TW" },
      durationSeconds: 1,
      fps: 24,
      width: 320,
      height: 180,
      assets: [
        { path: "clip.mp4", type: "video" },
        { path: "music.m4a", type: "audio" },
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
              assetPath: "clip.mp4",
              assetType: "video",
              start: 0,
              duration: 1,
              sourceIn: 0,
              sourceOut: 1,
              rationale: "Video-only fixture.",
            },
          ],
        },
        {
          id: "a1",
          type: "audio",
          items: [
            {
              id: "music",
              trackId: "a1",
              trackType: "audio",
              assetPath: "music.m4a",
              assetType: "audio",
              start: 0,
              duration: 1,
              sourceIn: 0,
              sourceOut: 1,
              rationale: "Explicit music fixture.",
            },
          ],
        },
      ],
      subtitles: [],
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

    const probe = await execFile("ffprobe", [
      "-v",
      "error",
      "-select_streams",
      "a:0",
      "-show_entries",
      "stream=codec_name",
      "-of",
      "csv=p=0",
      result.outputPath,
    ]);
    expect(probe.stdout.trim()).toBe("aac");
  });

  it("renders a real mp4 with burned-in subtitles when ffmpeg is installed", async () => {
    if (!(await hasFfmpeg())) {
      console.warn("Skipping subtitle render because ffmpeg is not installed.");
      return;
    }

    const root = await mkdtemp(join(tmpdir(), "opencut-render-subtitles-"));
    await execFile("ffmpeg", [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "color=c=blue:s=320x180:d=1",
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
      join(root, "clip.mp4"),
    ]);

    const timeline: ImportedTimeline = {
      project: { title: "Subtitle render", aspectRatio: "16:9", targetDurationSeconds: 1, language: "zh-TW" },
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
              rationale: "Subtitle fixture.",
            },
          ],
        },
      ],
      subtitles: [{ id: "cap-1", start: 0, duration: 1, text: "Smoke subtitle", language: "en" }],
      warnings: [],
    };
    const outputPath = join(root, ".ai-edits", "preview", "subtitled-output.mp4");

    const result = await renderTimelineWithFfmpeg(timeline, {
      mediaRoot: root,
      workDir: join(root, ".ai-edits", "render-work"),
      outputPath,
    });

    await access(result.outputPath);
    expect((await stat(result.outputPath)).size).toBeGreaterThan(0);

    const probe = await execFile("ffprobe", [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=codec_name",
      "-of",
      "csv=p=0",
      result.outputPath,
    ]);
    expect(probe.stdout.trim()).toBe("h264");
  });

  it("renders visual gaps so output duration follows the timeline", async () => {
    if (!(await hasFfmpeg())) {
      console.warn("Skipping visual gap render because ffmpeg or ffprobe is not installed.");
      return;
    }

    const root = await mkdtemp(join(tmpdir(), "opencut-render-gap-"));
    await execFile("ffmpeg", [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "color=c=yellow:s=320x180:d=1",
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
      join(root, "clip.mp4"),
    ]);

    const timeline: ImportedTimeline = {
      project: { title: "Gap render", aspectRatio: "16:9", targetDurationSeconds: 2, language: "zh-TW" },
      durationSeconds: 2,
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
              start: 1,
              duration: 1,
              sourceIn: 0,
              sourceOut: 1,
              rationale: "Fixture after an opening visual gap.",
            },
          ],
        },
      ],
      subtitles: [],
      warnings: [],
    };
    const outputPath = join(root, ".ai-edits", "preview", "gap-output.mp4");

    const result = await renderTimelineWithFfmpeg(timeline, {
      mediaRoot: root,
      workDir: join(root, ".ai-edits", "render-work"),
      outputPath,
    });

    await access(result.outputPath);
    expect((await stat(result.outputPath)).size).toBeGreaterThan(0);

    const probe = await execFile("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      result.outputPath,
    ]);
    const duration = Number(probe.stdout.trim());
    expect(duration).toBeGreaterThan(1.8);
    expect(duration).toBeLessThan(2.3);
  });

  it("renders sequential visual items from separate visual tracks", async () => {
    if (!(await hasFfmpeg())) {
      console.warn("Skipping multi-visual-track render because ffmpeg or ffprobe is not installed.");
      return;
    }

    const root = await mkdtemp(join(tmpdir(), "opencut-render-visual-tracks-"));
    await execFile("ffmpeg", [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "color=c=orange:s=320x180:d=1",
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
      join(root, "clip.mp4"),
    ]);
    await execFile("ffmpeg", [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "color=c=cyan:s=320x180:d=0.1",
      "-frames:v",
      "1",
      join(root, "still.png"),
    ]);

    const timeline: ImportedTimeline = {
      project: { title: "Visual tracks render", aspectRatio: "16:9", targetDurationSeconds: 2, language: "zh-TW" },
      durationSeconds: 2,
      fps: 24,
      width: 320,
      height: 180,
      assets: [
        { path: "clip.mp4", type: "video" },
        { path: "still.png", type: "image" },
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
              assetPath: "clip.mp4",
              assetType: "video",
              start: 0,
              duration: 1,
              sourceIn: 0,
              sourceOut: 1,
              rationale: "First visual track fixture.",
            },
          ],
        },
        {
          id: "i1",
          type: "image",
          items: [
            {
              id: "still",
              trackId: "i1",
              trackType: "image",
              assetPath: "still.png",
              assetType: "image",
              start: 1,
              duration: 1,
              sourceIn: 0,
              sourceOut: 1,
              rationale: "Second visual track fixture.",
            },
          ],
        },
      ],
      subtitles: [],
      warnings: [],
    };
    const outputPath = join(root, ".ai-edits", "preview", "visual-tracks-output.mp4");

    const result = await renderTimelineWithFfmpeg(timeline, {
      mediaRoot: root,
      workDir: join(root, ".ai-edits", "render-work"),
      outputPath,
    });

    await access(result.outputPath);
    expect((await stat(result.outputPath)).size).toBeGreaterThan(0);

    const probe = await execFile("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      result.outputPath,
    ]);
    const duration = Number(probe.stdout.trim());
    expect(duration).toBeGreaterThan(1.8);
    expect(duration).toBeLessThan(2.3);
  });
});
