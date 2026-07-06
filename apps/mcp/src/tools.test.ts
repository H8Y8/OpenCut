import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

import { createOpenCutMcpToolHandlers } from "./tools";

function validEditDecision() {
  return {
    schema_version: "opencut.ai-edit-decision.v1",
    project: {
      title: "Launch reel",
      aspect_ratio: "9:16",
      target_duration_seconds: 10,
      language: "zh-TW",
    },
    assets: [{ path: "clip.mp4", type: "video", sha256: "abc123" }],
    timeline: {
      duration_seconds: 10,
      tracks: [
        {
          id: "v1",
          type: "video",
          items: [
            {
              id: "hook",
              asset_path: "clip.mp4",
              start: 0,
              duration: 10,
              rationale: "Strong opening motion.",
            },
          ],
        },
      ],
    },
  };
}

async function writeJson(root: string, filename: string, payload: unknown) {
  const path = join(root, filename);
  await writeFile(path, JSON.stringify(payload, null, 2), "utf8");
  return path;
}

describe("createOpenCutMcpToolHandlers", () => {
  it("validates an edit-decision file and matching inventory file", async () => {
    const root = await mkdtemp(join(tmpdir(), "opencut-mcp-"));
    const editDecisionPath = await writeJson(root, "edit-decision.json", validEditDecision());
    const mediaInventoryPath = await writeJson(root, "media-inventory.json", {
      schema_version: "opencut.media-inventory.v1",
      root,
      summary: { video: 1, image: 0, audio: 0, other: 0 },
      assets: [{ path: "clip.mp4", type: "video", sha256: "abc123" }],
    });

    const handlers = createOpenCutMcpToolHandlers();
    const response = await handlers.validateEditDecision({ editDecisionPath, mediaInventoryPath });

    expect(response.content[0].type).toBe("text");
    const payload = JSON.parse(response.content[0].text);
    expect(payload.valid).toBe(true);
    expect(payload.errors).toEqual([]);
    expect(response.structuredContent).toMatchObject({ valid: true, errors: [] });
  });

  it("summarizes an edit-decision file as text", async () => {
    const root = await mkdtemp(join(tmpdir(), "opencut-mcp-"));
    const editDecisionPath = await writeJson(root, "edit-decision.json", validEditDecision());

    const handlers = createOpenCutMcpToolHandlers();
    const response = await handlers.summarizeEditDecision({ editDecisionPath });

    expect(response.content[0].text).toContain("Project: Launch reel");
    expect(response.content[0].text).toContain("Timeline: 10s, 1 track(s), 1 item(s)");
  });

  it("returns capabilities as JSON text", async () => {
    const handlers = createOpenCutMcpToolHandlers();
    const response = await handlers.getCapabilities();

    const payload = JSON.parse(response.content[0].text);
    expect(payload.execution.openCutNativeImport).toBe(false);
    expect(payload.tools).toContain("opencut_validate_edit_decision");
    expect(response.structuredContent).toMatchObject({
      execution: { openCutNativeImport: false },
    });
  });

  it("imports an edit-decision file into the editor-control session", async () => {
    const root = await mkdtemp(join(tmpdir(), "opencut-mcp-"));
    const editDecisionPath = await writeJson(root, "edit-decision.json", validEditDecision());
    const mediaInventoryPath = await writeJson(root, "media-inventory.json", {
      schema_version: "opencut.media-inventory.v1",
      root,
      summary: { video: 1, image: 0, audio: 0, other: 0 },
      assets: [{ path: "clip.mp4", type: "video", sha256: "abc123" }],
    });
    const handlers = createOpenCutMcpToolHandlers();

    const response = await handlers.importTimeline({ editDecisionPath, mediaInventoryPath });

    expect(response.structuredContent).toMatchObject({
      loaded: true,
      projectTitle: "Launch reel",
      trackCount: 1,
      itemCount: 1,
    });
  });

  it("returns timeline state after import and can select an item", async () => {
    const root = await mkdtemp(join(tmpdir(), "opencut-mcp-"));
    const editDecisionPath = await writeJson(root, "edit-decision.json", validEditDecision());
    const handlers = createOpenCutMcpToolHandlers();
    await handlers.importTimeline({ editDecisionPath });

    const selected = await handlers.selectTimelineItem({ itemId: "hook" });
    const state = await handlers.getTimelineState();

    expect(selected.structuredContent).toMatchObject({ loaded: true, selectedItemId: "hook" });
    expect(state.content[0].text).toContain("Project: Launch reel");
  });

  it("updates timeline item timing through the control session", async () => {
    const root = await mkdtemp(join(tmpdir(), "opencut-mcp-"));
    const editDecisionPath = await writeJson(root, "edit-decision.json", validEditDecision());
    const handlers = createOpenCutMcpToolHandlers();
    await handlers.importTimeline({ editDecisionPath });

    const response = await handlers.updateTimelineItemTiming({
      itemId: "hook",
      start: 1,
      duration: 5,
      sourceIn: 2,
      sourceOut: 7,
    });

    expect(response.structuredContent).toMatchObject({ loaded: true, selectedItemId: "hook" });
    const payload = response.structuredContent as {
      timeline: { tracks: Array<{ items: Array<{ id: string; start: number; duration: number }> }> };
    };
    expect(payload.timeline.tracks[0].items[0]).toMatchObject({ id: "hook", start: 1, duration: 5 });
  });

  it("dry-runs export for the currently loaded timeline", async () => {
    const root = await mkdtemp(join(tmpdir(), "opencut-mcp-"));
    const editDecisionPath = await writeJson(root, "edit-decision.json", validEditDecision());
    const handlers = createOpenCutMcpToolHandlers();
    await handlers.importTimeline({ editDecisionPath });

    const response = await handlers.exportTimeline({
      mediaRoot: root,
      workDir: join(root, ".ai-edits", "render-work"),
      outputPath: join(root, ".ai-edits", "preview", "output.mp4"),
      dryRun: true,
    });

    expect(response.structuredContent).toMatchObject({
      outputPath: join(root, ".ai-edits", "preview", "output.mp4"),
      dryRun: true,
    });
    expect(response.content[0].text).toContain("ffmpeg command plan");
  });

  it("rejects export when no timeline is loaded", async () => {
    const handlers = createOpenCutMcpToolHandlers();

    await expect(
      handlers.exportTimeline({
        mediaRoot: "/tmp/project",
        workDir: "/tmp/project/.ai-edits/render-work",
        outputPath: "/tmp/project/.ai-edits/preview/output.mp4",
      }),
    ).rejects.toThrow("no timeline is loaded");
  });
});
