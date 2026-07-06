import { pathToFileURL } from "node:url";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { createOpenCutMcpToolHandlers } from "./tools";

export const OPENCUT_MCP_TOOL_NAMES = [
  "opencut_get_capabilities",
  "opencut_validate_edit_decision",
  "opencut_summarize_edit_decision",
] as const;

type OpenCutMcpToolHandlers = ReturnType<typeof createOpenCutMcpToolHandlers>;

const editDecisionPathSchema = z.string().min(1).describe("Path to an OpenCut AI edit-decision JSON file.");
const mediaInventoryPathSchema = z
  .string()
  .min(1)
  .optional()
  .describe("Optional path to a media-inventory JSON file for source asset checks.");

export function createOpenCutMcpServer(handlers = createOpenCutMcpToolHandlers()): McpServer {
  const server = new McpServer({
    name: "opencut-mcp",
    version: "0.0.1",
  });

  registerOpenCutMcpTools(server, handlers);
  return server;
}

export function registerOpenCutMcpTools(
  server: McpServer,
  handlers: OpenCutMcpToolHandlers = createOpenCutMcpToolHandlers(),
): void {
  server.registerTool(
    "opencut_get_capabilities",
    {
      title: "Get OpenCut MCP capabilities",
      description:
        "Return the current OpenCut automation capabilities and honest caveats for this checkout.",
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async () => handlers.getCapabilities(),
  );

  server.registerTool(
    "opencut_validate_edit_decision",
    {
      title: "Validate OpenCut edit decision",
      description:
        "Validate an AI-generated OpenCut edit-decision JSON file, optionally checking source assets against a media inventory.",
      inputSchema: {
        editDecisionPath: editDecisionPathSchema,
        mediaInventoryPath: mediaInventoryPathSchema,
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async (args) =>
      handlers.validateEditDecision({
        editDecisionPath: String(args.editDecisionPath),
        mediaInventoryPath:
          typeof args.mediaInventoryPath === "string" ? args.mediaInventoryPath : undefined,
      }),
  );

  server.registerTool(
    "opencut_summarize_edit_decision",
    {
      title: "Summarize OpenCut edit decision",
      description:
        "Summarize an OpenCut edit-decision JSON file for a human or agent before applying it to a future OpenCut adapter.",
      inputSchema: {
        editDecisionPath: editDecisionPathSchema,
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async (args) =>
      handlers.summarizeEditDecision({
        editDecisionPath: String(args.editDecisionPath),
      }),
  );
}

export async function main(): Promise<void> {
  const server = createOpenCutMcpServer();
  await server.connect(new StdioServerTransport());
}

function isEntrypoint(): boolean {
  const scriptPath = process.argv[1];
  return scriptPath !== undefined && import.meta.url === pathToFileURL(scriptPath).href;
}

if (isEntrypoint()) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    console.error(message);
    process.exit(1);
  });
}
