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
