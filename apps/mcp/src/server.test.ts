import { describe, expect, it, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { OPENCUT_MCP_TOOL_NAMES, registerOpenCutMcpTools } from "./server";
import type { McpTextResponse } from "./tools";

const textResponse: McpTextResponse = {
  content: [{ type: "text", text: "{}" }],
};

describe("registerOpenCutMcpTools", () => {
  it("registers the expected OpenCut MCP tool names", () => {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    const registerTool = vi.spyOn(server, "registerTool");

    registerOpenCutMcpTools(server, {
      getCapabilities: vi.fn(async () => textResponse),
      validateEditDecision: vi.fn(async () => textResponse),
      summarizeEditDecision: vi.fn(async () => textResponse),
    });

    expect(registerTool.mock.calls.map((call) => call[0])).toEqual(OPENCUT_MCP_TOOL_NAMES);
  });
});
