import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

import { createOpenCutMcpToolHandlers } from "./tools";
import type { McpTextResponse } from "./tools";

export type ExportTimelineCliArgs = {
  editDecisionPath: string;
  mediaInventoryPath?: string;
  mediaRoot: string;
  workDir: string;
  outputPath: string;
  manifestPath?: string;
  dryRun: boolean;
};

type ExportTimelineCliHandlers = Pick<
  ReturnType<typeof createOpenCutMcpToolHandlers>,
  "importTimeline" | "exportTimeline"
>;

type TextWriter = {
  write(text: string): unknown;
};

type ExportTimelineCliDeps = {
  handlers?: ExportTimelineCliHandlers;
  stdout?: TextWriter;
};

const USAGE = "Usage: bun run export -- <edit-decision.json> --media-root <root> --out <output.mp4>";

export function parseExportTimelineCliArgs(args: string[]): ExportTimelineCliArgs {
  let editDecisionPath: string | undefined;
  let mediaInventoryPath: string | undefined;
  let mediaRoot: string | undefined;
  let outputPath: string | undefined;
  let manifestPath: string | undefined;
  let workDir: string | undefined;
  let dryRun = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      throw new Error(USAGE);
    }
    if (arg === "--inventory") {
      mediaInventoryPath = requireValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--media-root") {
      mediaRoot = requireValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--out") {
      outputPath = requireValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--manifest") {
      manifestPath = requireValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--work-dir") {
      workDir = requireValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (arg.startsWith("-")) {
      throw new Error(`${USAGE}\nUnknown option: ${arg}`);
    }
    if (editDecisionPath !== undefined) {
      throw new Error(`${USAGE}\nUnexpected positional argument: ${arg}`);
    }
    editDecisionPath = arg;
  }

  if (editDecisionPath === undefined || mediaRoot === undefined || outputPath === undefined) {
    throw new Error(USAGE);
  }

  return {
    editDecisionPath,
    mediaInventoryPath,
    mediaRoot,
    outputPath,
    workDir: workDir ?? join(dirname(outputPath), "..", "render-work"),
    manifestPath,
    dryRun,
  };
}

export async function runExportTimelineCli(
  args: string[],
  deps: ExportTimelineCliDeps = {},
): Promise<McpTextResponse> {
  const parsed = parseExportTimelineCliArgs(args);
  const handlers = deps.handlers ?? createOpenCutMcpToolHandlers();
  const stdout = deps.stdout ?? process.stdout;

  await handlers.importTimeline({
    editDecisionPath: parsed.editDecisionPath,
    mediaInventoryPath: parsed.mediaInventoryPath,
  });
  const response = await handlers.exportTimeline({
    mediaRoot: parsed.mediaRoot,
    workDir: parsed.workDir,
    outputPath: parsed.outputPath,
    manifestPath: parsed.manifestPath,
    dryRun: parsed.dryRun,
  });

  stdout.write(`${JSON.stringify(response.structuredContent ?? {}, null, 2)}\n`);
  return response;
}

function requireValue(args: string[], index: number, option: string): string {
  const value = args[index + 1];
  if (value === undefined || value.startsWith("-")) {
    throw new Error(`${USAGE}\nMissing value for ${option}`);
  }
  return value;
}

function isEntrypoint(): boolean {
  const scriptPath = process.argv[1];
  return scriptPath !== undefined && import.meta.url === pathToFileURL(scriptPath).href;
}

if (isEntrypoint()) {
  runExportTimelineCli(process.argv.slice(2)).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  });
}
