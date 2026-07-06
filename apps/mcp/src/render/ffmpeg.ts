import { execFile as execFileCallback } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

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
  preserveSourceAudio?: boolean;
  sourceAudioByAssetPath?: Record<string, boolean>;
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

export function buildFfmpegRenderPlan(
  timeline: ImportedTimeline,
  options: FfmpegRenderOptions,
): FfmpegRenderPlan {
  const mediaRoot = resolve(options.mediaRoot);
  const workDir = resolve(options.workDir);
  const outputPath = resolve(options.outputPath);
  assertInside(mediaRoot, workDir, "workDir must stay within mediaRoot or .ai-edits");
  assertInside(mediaRoot, outputPath, "outputPath must stay within mediaRoot or .ai-edits");

  const visualItems = primaryVisualItems(timeline);
  if (visualItems.length === 0) {
    throw new FfmpegRenderError("timeline must contain at least one video or image item to render");
  }

  const scaleFilter = [
    `scale=${timeline.width}:${timeline.height}:force_original_aspect_ratio=decrease`,
    `pad=${timeline.width}:${timeline.height}:(ow-iw)/2:(oh-ih)/2`,
    "setsar=1",
  ].join(",");

  const steps = visualItems.map((item, index) => {
    const segmentPath = join(workDir, `segment-${String(index).padStart(3, "0")}.mp4`);
    const inputPath = resolve(mediaRoot, item.assetPath);
    assertInside(mediaRoot, inputPath, `asset path escapes mediaRoot: ${item.assetPath}`);
    const inputArgs =
      item.assetType === "image"
        ? ["-loop", "1", "-t", formatSeconds(item.duration), "-i", inputPath]
        : ["-ss", formatSeconds(item.sourceIn), "-t", formatSeconds(item.duration), "-i", inputPath];
    const usesSourceAudio = shouldUseSourceAudio(item, options);
    const fallbackAudioArgs = usesSourceAudio
      ? []
      : [
          "-f",
          "lavfi",
          "-t",
          formatSeconds(item.duration),
          "-i",
          "anullsrc=channel_layout=stereo:sample_rate=48000",
        ];
    const audioMapArgs = usesSourceAudio ? ["-map", "0:a:0"] : ["-map", "1:a:0"];

    return {
      command: "ffmpeg" as const,
      outputPath: segmentPath,
      args: [
        "-y",
        ...inputArgs,
        ...fallbackAudioArgs,
        "-map",
        "0:v:0",
        ...audioMapArgs,
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
  const concatFileContent =
    steps.map((step) => `file '${step.outputPath.replaceAll("'", "'\\''")}'`).join("\n") + "\n";
  steps.push({
    command: "ffmpeg",
    outputPath,
    args: ["-y", "-f", "concat", "-safe", "0", "-i", concatFilePath, "-c", "copy", outputPath],
  });

  return { concatFilePath, concatFileContent, outputPath, steps };
}

export async function renderTimelineWithFfmpeg(
  timeline: ImportedTimeline,
  options: FfmpegRenderOptions & FfmpegRuntimeDeps,
): Promise<FfmpegRenderResult> {
  const run = options.execFile ?? ((command: string, args: string[]) => execFile(command, args));
  const sourceAudioByAssetPath =
    options.sourceAudioByAssetPath ?? (await detectSourceAudioByAssetPath(timeline, options, run));
  const plan = buildFfmpegRenderPlan(timeline, { ...options, sourceAudioByAssetPath });
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

function primaryVisualItems(timeline: ImportedTimeline): ImportedTimelineItem[] {
  const track = timeline.tracks.find((candidate) => candidate.type === "video" || candidate.type === "image");
  return track?.items.filter((item) => item.assetType === "video" || item.assetType === "image") ?? [];
}

function shouldUseSourceAudio(item: ImportedTimelineItem, options: FfmpegRenderOptions): boolean {
  if (item.assetType !== "video" || options.preserveSourceAudio === false) {
    return false;
  }
  return options.sourceAudioByAssetPath?.[item.assetPath] !== false;
}

async function detectSourceAudioByAssetPath(
  timeline: ImportedTimeline,
  options: FfmpegRenderOptions,
  run: (command: string, args: string[]) => Promise<unknown>,
): Promise<Record<string, boolean>> {
  if (options.preserveSourceAudio === false) {
    return {};
  }

  const mediaRoot = resolve(options.mediaRoot);
  const result: Record<string, boolean> = {};
  for (const item of primaryVisualItems(timeline)) {
    if (item.assetType !== "video" || result[item.assetPath] !== undefined) {
      continue;
    }
    const inputPath = resolve(mediaRoot, item.assetPath);
    assertInside(mediaRoot, inputPath, `asset path escapes mediaRoot: ${item.assetPath}`);
    result[item.assetPath] = await hasAudioStream(inputPath, run);
  }
  return result;
}

async function hasAudioStream(
  inputPath: string,
  run: (command: string, args: string[]) => Promise<unknown>,
): Promise<boolean> {
  try {
    const result = await run("ffprobe", [
      "-v",
      "error",
      "-select_streams",
      "a:0",
      "-show_entries",
      "stream=index",
      "-of",
      "csv=p=0",
      inputPath,
    ]);
    return stdoutFromExecResult(result).trim().length > 0;
  } catch {
    return false;
  }
}

function stdoutFromExecResult(result: unknown): string {
  if (typeof result === "object" && result !== null && "stdout" in result) {
    const stdout = result.stdout;
    return typeof stdout === "string" ? stdout : "";
  }
  return "";
}

function assertInside(root: string, value: string, message: string): void {
  if (value !== root && !value.startsWith(`${root}/`)) {
    throw new FfmpegRenderError(message);
  }
}

function formatSeconds(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}
