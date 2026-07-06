import { describe, expect, it, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { OPENCUT_MCP_TOOL_NAMES, registerOpenCutMcpTools } from "./server";
import type { McpTextResponse } from "./tools";

const textResponse: McpTextResponse = {
  content: [{ type: "text", text: "{}" }],
};

describe("registerOpenCutMcpTools", () => {
  it("declares the expected OpenCut MCP tool names", () => {
    expect(OPENCUT_MCP_TOOL_NAMES).toEqual([
      "opencut_get_capabilities",
      "opencut_validate_edit_decision",
      "opencut_summarize_edit_decision",
      "opencut_import_timeline",
      "opencut_get_timeline_state",
      "opencut_select_timeline_item",
      "opencut_update_timeline_item_timing",
    ]);
  });

  it("registers the expected OpenCut MCP tool names", () => {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    const registerTool = vi.spyOn(server, "registerTool");

    registerOpenCutMcpTools(server, {
      getCapabilities: vi.fn(async () => textResponse),
      validateEditDecision: vi.fn(async () => textResponse),
      summarizeEditDecision: vi.fn(async () => textResponse),
      importTimeline: vi.fn(async () => textResponse),
      getTimelineState: vi.fn(async () => textResponse),
      selectTimelineItem: vi.fn(async () => textResponse),
      updateTimelineItemTiming: vi.fn(async () => textResponse),
    });

    expect(registerTool.mock.calls.map((call) => call[0])).toEqual(OPENCUT_MCP_TOOL_NAMES);
  });
});
