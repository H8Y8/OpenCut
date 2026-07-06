import { describe, expect, it } from "vitest";

import { parseExportTimelineCliArgs, runExportTimelineCli } from "./exportTimelineCli";
import type { McpTextResponse } from "./tools";

const textResponse = (value: Record<string, unknown>): McpTextResponse => ({
  content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
  structuredContent: value,
});

describe("parseExportTimelineCliArgs", () => {
  it("parses the edit-decision path and render options", () => {
    expect(
      parseExportTimelineCliArgs([
        "project/edit-decision.json",
        "--inventory",
        "project/media-inventory.json",
        "--media-root",
        "project",
        "--out",
        "project/preview/output.mp4",
        "--work-dir",
        "project/render-work",
        "--manifest",
        "project/manifests/render.json",
        "--dry-run",
      ]),
    ).toEqual({
      editDecisionPath: "project/edit-decision.json",
      mediaInventoryPath: "project/media-inventory.json",
      mediaRoot: "project",
      outputPath: "project/preview/output.mp4",
      workDir: "project/render-work",
      manifestPath: "project/manifests/render.json",
      dryRun: true,
    });
  });

  it("derives a render work directory when --work-dir is omitted", () => {
    expect(
      parseExportTimelineCliArgs([
        "project/edit-decision.json",
        "--media-root",
        "project",
        "--out",
        "project/preview/output.mp4",
      ]).workDir,
    ).toBe("project/render-work");
  });

  it("rejects missing required arguments with usage text", () => {
    expect(() => parseExportTimelineCliArgs(["project/edit-decision.json"])).toThrow(
      "Usage: bun run export -- <edit-decision.json> --media-root <root> --out <output.mp4>",
    );
  });
});

describe("runExportTimelineCli", () => {
  it("imports the edit decision then exports the loaded timeline", async () => {
    const calls: Array<{ name: string; input: unknown }> = [];
    const output: string[] = [];

    await runExportTimelineCli(
      [
        "project/edit-decision.json",
        "--inventory",
        "project/media-inventory.json",
        "--media-root",
        "project",
        "--out",
        "project/preview/output.mp4",
        "--dry-run",
      ],
      {
        handlers: {
          importTimeline: async (input) => {
            calls.push({ name: "importTimeline", input });
            return textResponse({ loaded: true });
          },
          exportTimeline: async (input) => {
            calls.push({ name: "exportTimeline", input });
            return textResponse({ dryRun: true, outputPath: "project/preview/output.mp4" });
          },
        },
        stdout: { write: (text) => output.push(text) },
      },
    );

    expect(calls).toEqual([
      {
        name: "importTimeline",
        input: {
          editDecisionPath: "project/edit-decision.json",
          mediaInventoryPath: "project/media-inventory.json",
        },
      },
      {
        name: "exportTimeline",
        input: {
          mediaRoot: "project",
          workDir: "project/render-work",
          outputPath: "project/preview/output.mp4",
          manifestPath: undefined,
          dryRun: true,
        },
      },
    ]);
    expect(output.join("")).toContain('"outputPath": "project/preview/output.mp4"');
  });
});
