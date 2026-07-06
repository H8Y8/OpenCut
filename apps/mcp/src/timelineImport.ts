import { isAbsolute } from "node:path";

import { validateEditDecision } from "./editDecision";

export type ImportedTimelineAssetType = "video" | "image" | "audio" | "subtitle" | "generated";
export type ImportedTimelineTrackType = "video" | "image" | "audio" | "subtitle";

export type ImportedTimelineAsset = {
  path: string;
  type: ImportedTimelineAssetType;
  sha256?: string;
};

export type ImportedTimelineItem = {
  id: string;
  trackId: string;
  trackType: ImportedTimelineTrackType;
  assetPath: string;
  assetType: ImportedTimelineAssetType;
  start: number;
  duration: number;
  sourceIn: number;
  sourceOut: number;
  rationale: string;
};

export type ImportedTimelineTrack = {
  id: string;
  type: ImportedTimelineTrackType;
  items: ImportedTimelineItem[];
};

export type ImportedTimeline = {
  project: {
    title: string;
    aspectRatio: string;
    targetDurationSeconds: number;
    language: string;
  };
  durationSeconds: number;
  fps: number;
  width: number;
  height: number;
  assets: ImportedTimelineAsset[];
  tracks: ImportedTimelineTrack[];
  warnings: string[];
};

type ValidatedEditDecision = {
  project: {
    title: string;
    aspect_ratio: string;
    target_duration_seconds: number;
    language: string;
  };
  assets: Array<{
    path: string;
    type: ImportedTimelineAssetType;
    sha256?: string;
  }>;
  timeline: {
    duration_seconds: number;
    fps?: number;
    width?: number;
    height?: number;
    tracks: Array<{
      id: string;
      type: string;
      items: Array<{
        id: string;
        asset_path: string;
        start: number;
        duration: number;
        source_in?: number;
        source_out?: number;
        rationale: string;
      }>;
    }>;
  };
};

export class TimelineImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TimelineImportError";
  }
}

export function importTimeline(editDecision: unknown, mediaInventory?: unknown): ImportedTimeline {
  const validation = validateEditDecision(editDecision, mediaInventory);
  if (!validation.valid) {
    throw new TimelineImportError(validation.errors.join("; "));
  }
  if (!isRecord(editDecision)) {
    throw new TimelineImportError("edit decision must be a JSON object");
  }

  const plan = editDecision as ValidatedEditDecision;
  const assetByPath = new Map<string, ImportedTimelineAsset>();
  const assets = plan.assets.map((asset) => {
    assertSafeRelativePath(asset.path);
    const imported = {
      path: asset.path,
      type: asset.type,
      sha256: asset.sha256,
    };
    assetByPath.set(asset.path, imported);
    return imported;
  });

  const tracks = plan.timeline.tracks.map((track) => {
    if (!isExecutableTrackType(track.type)) {
      throw new TimelineImportError(`track '${track.id}' has unsupported executable type: ${track.type}`);
    }
    const trackType = track.type;
    const items = track.items
      .map((item) => {
        assertSafeRelativePath(item.asset_path);
        const asset = assetByPath.get(item.asset_path);
        if (asset === undefined) {
          throw new TimelineImportError(`item '${item.id}' references unknown asset: ${item.asset_path}`);
        }
        const sourceIn = item.source_in ?? 0;
        const sourceOut = item.source_out ?? sourceIn + item.duration;
        if (sourceOut <= sourceIn) {
          throw new TimelineImportError(`item '${item.id}' source_out must be greater than source_in`);
        }
        return {
          id: item.id,
          trackId: track.id,
          trackType,
          assetPath: item.asset_path,
          assetType: asset.type,
          start: item.start,
          duration: item.duration,
          sourceIn,
          sourceOut,
          rationale: item.rationale,
        };
      })
      .sort((left, right) => left.start - right.start || left.id.localeCompare(right.id));
    return { id: track.id, type: trackType, items };
  });

  return {
    project: {
      title: plan.project.title,
      aspectRatio: plan.project.aspect_ratio,
      targetDurationSeconds: plan.project.target_duration_seconds,
      language: plan.project.language,
    },
    durationSeconds: plan.timeline.duration_seconds,
    fps: plan.timeline.fps ?? 30,
    width: plan.timeline.width ?? widthFromAspectRatio(plan.project.aspect_ratio),
    height: plan.timeline.height ?? heightFromAspectRatio(plan.project.aspect_ratio),
    assets,
    tracks,
    warnings: validation.warnings,
  };
}

function assertSafeRelativePath(path: string): void {
  const parts = path.split(/[\\/]+/);
  if (path.length === 0 || isAbsolute(path) || parts.includes("..")) {
    throw new TimelineImportError(`asset path must be relative and stay within the media root: ${path}`);
  }
}

function isExecutableTrackType(value: string): value is ImportedTimelineTrackType {
  return value === "video" || value === "image" || value === "audio" || value === "subtitle";
}

function widthFromAspectRatio(aspectRatio: string): number {
  return aspectRatio === "16:9" ? 1920 : 1080;
}

function heightFromAspectRatio(aspectRatio: string): number {
  return aspectRatio === "16:9" ? 1080 : aspectRatio === "1:1" ? 1080 : 1920;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
