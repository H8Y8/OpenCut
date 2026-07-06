import { readFile } from "node:fs/promises";

import {
  getOpenCutMcpCapabilities,
  summarizeEditDecision,
  validateEditDecision,
} from "./editDecision";
import { OpenCutEditorSession, summarizeTimelineState } from "./editorSession";
import { buildFfmpegRenderPlan, renderTimelineWithFfmpeg } from "./render/ffmpeg";
import { importTimeline as importEditDecisionTimeline } from "./timelineImport";

type TextContent = {
  type: "text";
  text: string;
};

export type McpTextResponse = {
  content: TextContent[];
  structuredContent?: Record<string, unknown>;
};

type ToolHandlerDeps = {
  readTextFile?: (path: string) => Promise<string>;
  editorSession?: OpenCutEditorSession;
};

type ValidateEditDecisionInput = {
  editDecisionPath: string;
  mediaInventoryPath?: string;
};

type SummarizeEditDecisionInput = {
  editDecisionPath: string;
};

type SelectTimelineItemInput = {
  itemId: string;
};

type UpdateTimelineItemTimingInput = {
  itemId: string;
  start?: number;
  duration?: number;
  sourceIn?: number;
  sourceOut?: number;
};

type ExportTimelineInput = {
  mediaRoot: string;
  workDir: string;
  outputPath: string;
  dryRun?: boolean;
};

export function createOpenCutMcpToolHandlers(deps: ToolHandlerDeps = {}) {
  const readTextFile = deps.readTextFile ?? ((path: string) => readFile(path, "utf8"));
  const editorSession = deps.editorSession ?? new OpenCutEditorSession();

  return {
    async getCapabilities(): Promise<McpTextResponse> {
      return jsonResponse(getOpenCutMcpCapabilities());
    },

    async validateEditDecision(input: ValidateEditDecisionInput): Promise<McpTextResponse> {
      const editDecision = await readJson(readTextFile, input.editDecisionPath, "edit decision");
      const mediaInventory = input.mediaInventoryPath
        ? await readJson(readTextFile, input.mediaInventoryPath, "media inventory")
        : undefined;

      return jsonResponse(validateEditDecision(editDecision, mediaInventory));
    },

    async summarizeEditDecision(input: SummarizeEditDecisionInput): Promise<McpTextResponse> {
      const editDecision = await readJson(readTextFile, input.editDecisionPath, "edit decision");
      return textResponse(summarizeEditDecision(editDecision));
    },

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

    async selectTimelineItem(input: SelectTimelineItemInput): Promise<McpTextResponse> {
      return jsonResponse(editorSession.selectItem(input.itemId));
    },

    async updateTimelineItemTiming(input: UpdateTimelineItemTimingInput): Promise<McpTextResponse> {
      return jsonResponse(editorSession.updateItemTiming(input.itemId, input));
    },

    async exportTimeline(input: ExportTimelineInput): Promise<McpTextResponse> {
      const state = editorSession.getState();
      if (!state.loaded) {
        throw new Error("no timeline is loaded");
      }
      if (input.dryRun === true) {
        const plan = buildFfmpegRenderPlan(state.timeline, input);
        const response = jsonResponse({
          dryRun: true,
          outputPath: plan.outputPath,
          commandCount: plan.steps.length,
          commands: plan.steps.map((step) => ({ command: step.command, args: step.args })),
        });
        response.content[0].text = `ffmpeg command plan\n${response.content[0].text}`;
        return response;
      }
      const result = await renderTimelineWithFfmpeg(state.timeline, input);
      return jsonResponse({
        dryRun: false,
        outputPath: result.outputPath,
        commandCount: result.commandCount,
      });
    },
  };
}

async function readJson(
  readTextFile: (path: string) => Promise<string>,
  path: string,
  label: string,
): Promise<unknown> {
  if (path.length === 0) {
    throw new Error(`${label} path must be a non-empty string`);
  }

  const content = await readTextFile(path);
  try {
    return JSON.parse(content) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${label} at ${path} is not valid JSON: ${message}`);
  }
}

function jsonResponse(value: unknown): McpTextResponse {
  const response = textResponse(JSON.stringify(value, null, 2));
  if (isRecord(value)) {
    response.structuredContent = value;
  }
  return response;
}

function textResponse(text: string): McpTextResponse {
  return {
    content: [
      {
        type: "text",
        text,
      },
    ],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
