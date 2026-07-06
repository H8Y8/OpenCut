import { readFile } from "node:fs/promises";

import {
  getOpenCutMcpCapabilities,
  summarizeEditDecision,
  validateEditDecision,
} from "./editDecision";

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
};

type ValidateEditDecisionInput = {
  editDecisionPath: string;
  mediaInventoryPath?: string;
};

type SummarizeEditDecisionInput = {
  editDecisionPath: string;
};

export function createOpenCutMcpToolHandlers(deps: ToolHandlerDeps = {}) {
  const readTextFile = deps.readTextFile ?? ((path: string) => readFile(path, "utf8"));

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
