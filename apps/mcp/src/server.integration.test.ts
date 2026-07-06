import { fileURLToPath } from "node:url";
import { execFile as execFileCallback } from "node:child_process";
import { access, mkdtemp, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { describe, expect, it } from "vitest";

import { OPENCUT_MCP_TOOL_NAMES } from "./server";

const appRoot = fileURLToPath(new URL("..", import.meta.url));
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

      const exportPlan = (await client.callTool({
        name: "opencut_export_timeline",
        arguments: {
          mediaRoot: root,
          workDir: join(root, ".ai-edits", "render-work"),
          outputPath: join(root, ".ai-edits", "preview", "output.mp4"),
          dryRun: true,
        },
      })) as {
        structuredContent?: Record<string, unknown>;
      };
      expect(exportPlan.structuredContent).toMatchObject({
        dryRun: true,
        outputPath: join(root, ".ai-edits", "preview", "output.mp4"),
      });
    } finally {
      await client.close();
    }
  });

  it("exports a loaded timeline through stdio when ffmpeg is installed", async () => {
    if (!(await hasFfmpeg())) {
      console.warn("Skipping stdio export render because ffmpeg or ffprobe is not installed.");
      return;
    }

    const root = await mkdtemp(join(tmpdir(), "opencut-mcp-export-"));
    const mediaPath = join(root, "clip.mp4");
    await execFile("ffmpeg", [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "color=c=green:s=320x180:d=1",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=1",
      "-shortest",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      mediaPath,
    ]);

    const editDecisionPath = join(root, "edit-decision.json");
    await writeFile(
      editDecisionPath,
      JSON.stringify({
        schema_version: "opencut.ai-edit-decision.v1",
        project: {
          title: "Client export smoke test",
          aspect_ratio: "16:9",
          target_duration_seconds: 1,
          language: "zh-TW",
        },
        assets: [{ path: "clip.mp4", type: "video" }],
        timeline: {
          duration_seconds: 1,
          fps: 24,
          width: 320,
          height: 180,
          tracks: [
            {
              id: "v1",
              type: "video",
              items: [
                {
                  id: "clip-1",
                  asset_path: "clip.mp4",
                  start: 0,
                  duration: 1,
                  source_in: 0,
                  source_out: 1,
                  rationale: "Stdio export smoke-test clip.",
                },
              ],
            },
          ],
        },
      }),
      "utf8",
    );

    const client = new Client({ name: "opencut-mcp-export-test-client", version: "0.0.0" });
    const transport = new StdioClientTransport({
      command: "bun",
      args: ["run", "src/server.ts"],
      cwd: appRoot,
      stderr: "pipe",
    });
    const outputPath = join(root, ".ai-edits", "preview", "output.mp4");

    await client.connect(transport);
    try {
      await client.callTool({
        name: "opencut_import_timeline",
        arguments: { editDecisionPath },
      });
      const exported = (await client.callTool({
        name: "opencut_export_timeline",
        arguments: {
          mediaRoot: root,
          workDir: join(root, ".ai-edits", "render-work"),
          outputPath,
        },
      })) as {
        structuredContent?: Record<string, unknown>;
      };

      expect(exported.structuredContent).toMatchObject({
        dryRun: false,
        outputPath,
      });
      await access(outputPath);
      expect((await stat(outputPath)).size).toBeGreaterThan(0);
    } finally {
      await client.close();
    }
  });
});
