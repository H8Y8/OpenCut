import { fileURLToPath } from "node:url";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { describe, expect, it } from "vitest";

import { OPENCUT_MCP_TOOL_NAMES } from "./server";

const appRoot = fileURLToPath(new URL("..", import.meta.url));

describe("OpenCut MCP stdio server", () => {
  it("lists tools and calls opencut_get_capabilities through a real MCP client", async () => {
    const client = new Client({ name: "opencut-mcp-test-client", version: "0.0.0" });
    const transport = new StdioClientTransport({
      command: "bun",
      args: ["run", "src/server.ts"],
      cwd: appRoot,
      stderr: "pipe",
    });

    await client.connect(transport);
    try {
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name)).toEqual(expect.arrayContaining([...OPENCUT_MCP_TOOL_NAMES]));

      const result = (await client.callTool({
        name: "opencut_get_capabilities",
        arguments: {},
      })) as {
        content: Array<{ type: "text"; text: string } | { type: string }>;
        structuredContent?: Record<string, unknown>;
      };
      const firstContent = result.content[0];

      expect(firstContent?.type).toBe("text");
      if (firstContent?.type !== "text") {
        throw new Error("Expected text content from opencut_get_capabilities");
      }
      const textContent = firstContent as { type: "text"; text: string };
      const capabilities = JSON.parse(textContent.text);
      expect(capabilities.execution.openCutNativeImport).toBe(false);
      expect(capabilities.tools).toEqual([...OPENCUT_MCP_TOOL_NAMES]);
      expect(result.structuredContent).toMatchObject({
        execution: { openCutNativeImport: false },
      });

      const root = await mkdtemp(join(tmpdir(), "opencut-mcp-client-"));
      const editDecisionPath = join(root, "edit-decision.json");
      const mediaInventoryPath = join(root, "media-inventory.json");
      await writeFile(
        editDecisionPath,
        JSON.stringify({
          schema_version: "opencut.ai-edit-decision.v1",
          project: {
            title: "Client smoke test",
            aspect_ratio: "9:16",
            target_duration_seconds: 3,
            language: "zh-TW",
          },
          assets: [{ path: "clip.mp4", type: "video", sha256: "abc123" }],
          timeline: {
            duration_seconds: 3,
            tracks: [
              {
                id: "v1",
                type: "video",
                items: [
                  {
                    id: "clip-1",
                    asset_path: "clip.mp4",
                    start: 0,
                    duration: 3,
                    rationale: "Smoke-test clip.",
                  },
                ],
              },
            ],
          },
        }),
        "utf8",
      );
      await writeFile(
        mediaInventoryPath,
        JSON.stringify({
          schema_version: "opencut.media-inventory.v1",
          root,
          summary: { video: 1, image: 0, audio: 0, other: 0 },
          assets: [{ path: "clip.mp4", type: "video", sha256: "abc123" }],
        }),
        "utf8",
      );

      const validation = (await client.callTool({
        name: "opencut_validate_edit_decision",
        arguments: { editDecisionPath, mediaInventoryPath },
      })) as {
        content: Array<{ type: "text"; text: string } | { type: string }>;
        structuredContent?: Record<string, unknown>;
      };
      const validationContent = validation.content[0] as { type: "text"; text: string };
      expect(JSON.parse(validationContent.text).valid).toBe(true);
      expect(validation.structuredContent).toMatchObject({ valid: true });

      const imported = (await client.callTool({
        name: "opencut_import_timeline",
        arguments: { editDecisionPath, mediaInventoryPath },
      })) as {
        structuredContent?: Record<string, unknown>;
      };
      expect(imported.structuredContent).toMatchObject({
        loaded: true,
        projectTitle: "Client smoke test",
      });

      const state = (await client.callTool({
        name: "opencut_get_timeline_state",
        arguments: {},
      })) as {
        structuredContent?: Record<string, unknown>;
      };
      expect(state.structuredContent).toMatchObject({
        loaded: true,
        projectTitle: "Client smoke test",
      });
    } finally {
      await client.close();
    }
  });
});
