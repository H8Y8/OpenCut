import { pathToFileURL } from "node:url";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { createOpenCutMcpToolHandlers } from "./tools";

export const OPENCUT_MCP_TOOL_NAMES = [
  "opencut_get_capabilities",
  "opencut_validate_edit_decision",
  "opencut_summarize_edit_decision",
  "opencut_import_timeline",
  "opencut_get_timeline_state",
  "opencut_select_timeline_item",
  "opencut_update_timeline_item_timing",
  "opencut_export_timeline",
] as const;

type OpenCutMcpToolHandlers = ReturnType<typeof createOpenCutMcpToolHandlers>;

const editDecisionPathSchema = z.string().min(1).describe("Path to an OpenCut AI edit-decision JSON file.");
const mediaInventoryPathSchema = z
  .string()
  .min(1)
  .optional()
  .describe("Optional path to a media-inventory JSON file for source asset checks.");
const itemIdSchema = z.string().min(1).describe("Timeline item id.");
const optionalNumberSchema = z.number().finite().optional();
const filesystemPathSchema = z.string().min(1);

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

  server.registerTool(
    "opencut_import_timeline",
    {
      title: "Import OpenCut timeline",
      description:
        "Load an OpenCut edit-decision JSON file into the in-memory editor-control session.",
      inputSchema: {
        editDecisionPath: editDecisionPathSchema,
        mediaInventoryPath: mediaInventoryPathSchema,
      },
      annotations: {
        readOnlyHint: false,
        openWorldHint: false,
      },
    },
    async (args) =>
      handlers.importTimeline({
        editDecisionPath: String(args.editDecisionPath),
        mediaInventoryPath:
          typeof args.mediaInventoryPath === "string" ? args.mediaInventoryPath : undefined,
      }),
  );

  server.registerTool(
    "opencut_get_timeline_state",
    {
      title: "Get OpenCut timeline state",
      description: "Return the currently loaded in-memory OpenCut timeline-control state.",
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async () => handlers.getTimelineState(),
  );

  server.registerTool(
    "opencut_select_timeline_item",
    {
      title: "Select OpenCut timeline item",
      description: "Select a timeline item in the in-memory OpenCut editor-control session.",
      inputSchema: {
        itemId: itemIdSchema,
      },
      annotations: {
        readOnlyHint: false,
        openWorldHint: false,
      },
    },
    async (args) =>
      handlers.selectTimelineItem({
        itemId: String(args.itemId),
      }),
  );

  server.registerTool(
    "opencut_update_timeline_item_timing",
    {
      title: "Update OpenCut timeline item timing",
      description:
        "Update simple timing and source trim metadata for one loaded timeline item.",
      inputSchema: {
        itemId: itemIdSchema,
        start: optionalNumberSchema,
        duration: optionalNumberSchema,
        sourceIn: optionalNumberSchema,
        sourceOut: optionalNumberSchema,
      },
      annotations: {
        readOnlyHint: false,
        openWorldHint: false,
      },
    },
    async (args) =>
      handlers.updateTimelineItemTiming({
        itemId: String(args.itemId),
        start: typeof args.start === "number" ? args.start : undefined,
        duration: typeof args.duration === "number" ? args.duration : undefined,
        sourceIn: typeof args.sourceIn === "number" ? args.sourceIn : undefined,
        sourceOut: typeof args.sourceOut === "number" ? args.sourceOut : undefined,
      }),
  );

  server.registerTool(
    "opencut_export_timeline",
    {
      title: "Export OpenCut timeline",
      description: "Render the loaded edit-decision timeline through the local ffmpeg adapter.",
      inputSchema: {
        mediaRoot: filesystemPathSchema.describe("Root folder used to resolve relative asset paths."),
        workDir: filesystemPathSchema.describe("Temporary render work directory."),
        outputPath: filesystemPathSchema.describe("Final mp4 output path."),
        dryRun: z.boolean().optional().describe("Return the ffmpeg command plan without running ffmpeg."),
      },
      annotations: {
        readOnlyHint: false,
        openWorldHint: false,
      },
    },
    async (args) =>
      handlers.exportTimeline({
        mediaRoot: String(args.mediaRoot),
        workDir: String(args.workDir),
        outputPath: String(args.outputPath),
        dryRun: typeof args.dryRun === "boolean" ? args.dryRun : undefined,
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
