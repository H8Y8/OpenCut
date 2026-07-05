export const EDIT_DECISION_SCHEMA_VERSION = "opencut.ai-edit-decision.v1";

export type ValidationResult = {
  valid: boolean;
  errors: string[];
  warnings: string[];
};

export type OpenCutMcpCapabilities = {
  server: {
    name: string;
    version: string;
  };
  artifacts: string[];
  tools: string[];
  execution: {
    openCutNativeImport: boolean;
    editorApi: boolean;
    pluginApi: boolean;
    headlessRender: boolean;
  };
  caveats: string[];
};

type JsonObject = Record<string, unknown>;

type Asset = {
  path: string;
  type: string;
  sha256?: string;
};

type TimelineItem = {
  id: string;
  asset_path: string;
  start: number;
  duration: number;
  source_in?: number;
  source_out?: number;
  rationale: string;
};

type Track = {
  id: string;
  type: string;
  items: TimelineItem[];
};

type SubtitleCue = {
  id: string;
  start: number;
  duration: number;
  text: string;
};

type EditDecision = {
  schema_version: string;
  project: {
    title: string;
    aspect_ratio: string;
    target_duration_seconds: number;
    language: string;
    brief?: string;
    platform?: string;
    style?: string[];
    assumptions?: string[];
  };
  assets: Asset[];
  timeline: {
    duration_seconds: number;
    fps?: number;
    width?: number;
    height?: number;
    tracks: Track[];
  };
  subtitles?: SubtitleCue[];
  music?: JsonObject;
  rationale?: string[];
  open_questions?: string[];
};

type MediaInventory = {
  schema_version?: string;
  root?: string;
  summary?: JsonObject;
  assets: Asset[];
};

const SUPPORTED_ASSET_TYPES = new Set(["video", "image", "audio", "subtitle", "generated"]);
const OVERLAP_TRACK_TYPES = new Set(["video", "audio", "subtitle"]);

export function getOpenCutMcpCapabilities(): OpenCutMcpCapabilities {
  return {
    server: {
      name: "opencut-mcp",
      version: "0.0.1",
    },
    artifacts: ["media-inventory.json", "creative-brief.md", "scene-notes.md", "edit-decision.json"],
    tools: [
      "opencut_get_capabilities",
      "opencut_validate_edit_decision",
      "opencut_summarize_edit_decision",
    ],
    execution: {
      openCutNativeImport: false,
      editorApi: false,
      pluginApi: false,
      headlessRender: false,
    },
    caveats: [
      "This server validates and summarizes AI edit-decision packages; it does not render video until OpenCut exposes a real editor API, plugin API, MCP surface, or headless renderer.",
    ],
  };
}

export function validateEditDecision(editDecision: unknown, mediaInventory?: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!isObject(editDecision)) {
    return {
      valid: false,
      errors: ["edit decision must be a JSON object"],
      warnings,
    };
  }

  const plan = editDecision as Partial<EditDecision>;
  if (plan.schema_version !== EDIT_DECISION_SCHEMA_VERSION) {
    errors.push(
      `schema_version must be '${EDIT_DECISION_SCHEMA_VERSION}', got ${formatValue(plan.schema_version)}`,
    );
  }

  const project = requireObject(plan.project, "project", errors) as Partial<EditDecision["project"]>;
  const timeline = requireObject(plan.timeline, "timeline", errors) as Partial<EditDecision["timeline"]>;
  const assets = requireArray(plan.assets, "assets", errors);

  const targetDuration = asNumber(project.target_duration_seconds);
  if (targetDuration === undefined || targetDuration <= 0) {
    errors.push("project.target_duration_seconds must be a positive number");
  }

  const timelineDuration = asNumber(timeline.duration_seconds);
  if (timelineDuration === undefined || timelineDuration <= 0) {
    errors.push("timeline.duration_seconds must be a positive number");
  } else if (targetDuration !== undefined && targetDuration > 0) {
    const tolerance = Math.max(targetDuration * 0.1, 0.25);
    if (Math.abs(timelineDuration - targetDuration) > tolerance) {
      warnings.push(
        `timeline.duration_seconds differs from project.target_duration_seconds by more than 10%: ${timelineDuration} vs ${targetDuration}`,
      );
    }
  }

  const planAssets = collectPlanAssets(assets, errors);
  validateInventory(planAssets, mediaInventory, errors);
  validateTracks(timeline.tracks, planAssets, errors, warnings);
  validateSubtitles(plan.subtitles, errors);

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

export function summarizeEditDecision(editDecision: unknown): string {
  const result = validateEditDecision(editDecision);
  if (!result.valid) {
    return [`Invalid edit decision:`, ...result.errors.map((error) => `- ${error}`)].join("\n");
  }

  const plan = editDecision as EditDecision;
  const assetCounts = countBy(plan.assets, (asset) => asset.type);
  const trackCount = plan.timeline.tracks.length;
  const itemCount = plan.timeline.tracks.reduce((total, track) => total + track.items.length, 0);
  const subtitleCount = plan.subtitles?.length ?? 0;

  const assetSummary = Object.entries(assetCounts)
    .map(([type, count]) => `${type}: ${count}`)
    .join(", ");

  return [
    `Project: ${plan.project.title}`,
    `Target: ${plan.project.aspect_ratio}, ${plan.project.target_duration_seconds}s, ${plan.project.language}`,
    `Timeline: ${plan.timeline.duration_seconds}s, ${trackCount} track(s), ${itemCount} item(s)`,
    `Assets: ${plan.assets.length} total (${assetSummary})`,
    `Subtitles: ${subtitleCount} cue(s)`,
  ].join("\n");
}

function collectPlanAssets(assets: unknown[], errors: string[]): Map<string, Asset> {
  const result = new Map<string, Asset>();
  assets.forEach((item, index) => {
    if (!isObject(item)) {
      errors.push(`assets[${index}] must be an object`);
      return;
    }

    const path = item.path;
    const type = item.type;
    if (typeof path !== "string" || path.length === 0) {
      errors.push(`assets[${index}].path must be a non-empty string`);
      return;
    }
    if (result.has(path)) {
      errors.push(`duplicate asset path: ${path}`);
    }
    if (typeof type !== "string" || !SUPPORTED_ASSET_TYPES.has(type)) {
      errors.push(`assets[${index}].type has unsupported value: ${formatValue(type)}`);
    }

    result.set(path, {
      path,
      type: typeof type === "string" ? type : "unknown",
      sha256: typeof item.sha256 === "string" ? item.sha256 : undefined,
    });
  });
  return result;
}

function validateInventory(
  planAssets: Map<string, Asset>,
  mediaInventory: unknown,
  errors: string[],
): void {
  if (mediaInventory === undefined) {
    return;
  }
  if (!isObject(mediaInventory)) {
    errors.push("media inventory must be a JSON object");
    return;
  }

  const inventory = mediaInventory as Partial<MediaInventory>;
  const inventoryAssets = requireArray(inventory.assets, "mediaInventory.assets", errors);
  const inventoryByPath = new Map<string, Asset>();
  inventoryAssets.forEach((item) => {
    if (!isObject(item) || typeof item.path !== "string") {
      return;
    }
    inventoryByPath.set(item.path, {
      path: item.path,
      type: typeof item.type === "string" ? item.type : "unknown",
      sha256: typeof item.sha256 === "string" ? item.sha256 : undefined,
    });
  });

  for (const [path, asset] of planAssets.entries()) {
    if (asset.type === "generated") {
      continue;
    }
    const inventoryAsset = inventoryByPath.get(path);
    if (inventoryAsset === undefined) {
      errors.push(`asset '${path}' is not present in media inventory`);
      continue;
    }
    if (asset.sha256 !== undefined && inventoryAsset.sha256 !== undefined && asset.sha256 !== inventoryAsset.sha256) {
      errors.push(`asset '${path}' sha256 does not match media inventory`);
    }
  }
}

function validateTracks(
  tracksValue: unknown,
  planAssets: Map<string, Asset>,
  errors: string[],
  warnings: string[],
): void {
  const tracks = requireArray(tracksValue, "timeline.tracks", errors);
  if (tracks.length === 0) {
    errors.push("timeline.tracks must contain at least one track");
  }

  tracks.forEach((trackValue, trackIndex) => {
    if (!isObject(trackValue)) {
      errors.push(`timeline.tracks[${trackIndex}] must be an object`);
      return;
    }

    const trackId = typeof trackValue.id === "string" ? trackValue.id : `#${trackIndex}`;
    const trackType = typeof trackValue.type === "string" ? trackValue.type : "unknown";
    const items = requireArray(trackValue.items, `timeline.tracks[${trackIndex}].items`, errors);
    let previousEnd = 0;

    items.forEach((itemValue, itemIndex) => {
      const label = `track '${trackId}' item[${itemIndex}]`;
      if (!isObject(itemValue)) {
        errors.push(`${label} must be an object`);
        return;
      }

      const assetPath = itemValue.asset_path;
      if (typeof assetPath !== "string" || assetPath.length === 0) {
        errors.push(`${label}.asset_path must be a non-empty string`);
      } else if (!planAssets.has(assetPath)) {
        errors.push(`${label} references asset_path not listed in assets: '${assetPath}'`);
      }

      const start = asNumber(itemValue.start);
      const duration = asNumber(itemValue.duration);
      const effectiveStart = start ?? previousEnd;
      const effectiveDuration = duration ?? 0;

      if (start === undefined || start < 0) {
        errors.push(`${label}.start must be a non-negative number`);
      }
      if (duration === undefined || duration <= 0) {
        errors.push(`${label}.duration must be a positive number`);
      }
      if (effectiveStart < previousEnd && OVERLAP_TRACK_TYPES.has(trackType)) {
        warnings.push(`${label} overlaps the previous item on the same track`);
      }
      previousEnd = Math.max(previousEnd, effectiveStart + effectiveDuration);
    });
  });
}

function validateSubtitles(subtitlesValue: unknown, errors: string[]): void {
  if (subtitlesValue === undefined) {
    return;
  }
  const subtitles = requireArray(subtitlesValue, "subtitles", errors);
  subtitles.forEach((subtitleValue, index) => {
    if (!isObject(subtitleValue)) {
      errors.push(`subtitles[${index}] must be an object`);
      return;
    }
    const start = asNumber(subtitleValue.start);
    const duration = asNumber(subtitleValue.duration);
    if (start === undefined || start < 0) {
      errors.push(`subtitles[${index}].start must be a non-negative number`);
    }
    if (duration === undefined || duration <= 0) {
      errors.push(`subtitles[${index}].duration must be a positive number`);
    }
    if (typeof subtitleValue.text !== "string" || subtitleValue.text.length === 0) {
      errors.push(`subtitles[${index}].text must be a non-empty string`);
    }
  });
}

function requireObject(value: unknown, label: string, errors: string[]): JsonObject {
  if (!isObject(value)) {
    errors.push(`${label} must be an object`);
    return {};
  }
  return value;
}

function requireArray(value: unknown, label: string, errors: string[]): unknown[] {
  if (!Array.isArray(value)) {
    errors.push(`${label} must be an array`);
    return [];
  }
  return value;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function countBy<T>(items: T[], keyFn: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const key = keyFn(item);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function formatValue(value: unknown): string {
  return typeof value === "string" ? `'${value}'` : String(value);
}
