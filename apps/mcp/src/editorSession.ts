import type { ImportedTimeline, ImportedTimelineItem } from "./timelineImport";

export type EditorSessionSource = {
  editDecisionPath?: string;
  mediaInventoryPath?: string;
};

export type EmptyEditorSessionState = {
  loaded: false;
};

export type LoadedEditorSessionState = {
  loaded: true;
  projectTitle: string;
  durationSeconds: number;
  width: number;
  height: number;
  fps: number;
  trackCount: number;
  itemCount: number;
  selectedItemId?: string;
  source: EditorSessionSource;
  timeline: ImportedTimeline;
};

export type EditorSessionState = EmptyEditorSessionState | LoadedEditorSessionState;

export type ItemTimingPatch = {
  start?: number;
  duration?: number;
  sourceIn?: number;
  sourceOut?: number;
};

export class EditorSessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EditorSessionError";
  }
}

export class OpenCutEditorSession {
  private timeline?: ImportedTimeline;
  private source: EditorSessionSource = {};
  private selectedItemId?: string;

  getState(): EditorSessionState {
    if (this.timeline === undefined) {
      return { loaded: false };
    }
    return loadedState(this.timeline, this.source, this.selectedItemId);
  }

  load(timeline: ImportedTimeline, source: EditorSessionSource): LoadedEditorSessionState {
    this.timeline = cloneTimeline(timeline);
    this.source = { ...source };
    this.selectedItemId = undefined;
    return loadedState(this.timeline, this.source, this.selectedItemId);
  }

  selectItem(itemId: string): LoadedEditorSessionState {
    const timeline = this.requireTimeline();
    if (findItem(timeline, itemId) === undefined) {
      throw new EditorSessionError(`timeline item not found: ${itemId}`);
    }
    this.selectedItemId = itemId;
    return loadedState(timeline, this.source, this.selectedItemId);
  }

  updateItemTiming(itemId: string, patch: ItemTimingPatch): LoadedEditorSessionState {
    const timeline = cloneTimeline(this.requireTimeline());
    const item = findItem(timeline, itemId);
    if (item === undefined) {
      throw new EditorSessionError(`timeline item not found: ${itemId}`);
    }

    const nextStart = patch.start ?? item.start;
    const nextDuration = patch.duration ?? item.duration;
    const nextSourceIn = patch.sourceIn ?? item.sourceIn;
    const nextSourceOut = patch.sourceOut ?? item.sourceOut;
    if (nextStart < 0) {
      throw new EditorSessionError("item start must be non-negative");
    }
    if (nextDuration <= 0) {
      throw new EditorSessionError("item duration must be positive");
    }
    if (nextSourceIn < 0) {
      throw new EditorSessionError("item sourceIn must be non-negative");
    }
    if (nextSourceOut <= nextSourceIn) {
      throw new EditorSessionError("item sourceOut must be greater than sourceIn");
    }

    item.start = nextStart;
    item.duration = nextDuration;
    item.sourceIn = nextSourceIn;
    item.sourceOut = nextSourceOut;
    sortTimeline(timeline);
    this.timeline = timeline;
    this.selectedItemId = itemId;
    return loadedState(timeline, this.source, this.selectedItemId);
  }

  private requireTimeline(): ImportedTimeline {
    if (this.timeline === undefined) {
      throw new EditorSessionError("no timeline is loaded");
    }
    return this.timeline;
  }
}

export function summarizeTimelineState(state: EditorSessionState): string {
  if (!state.loaded) {
    return "No OpenCut timeline is loaded.";
  }
  return [
    `Project: ${state.projectTitle}`,
    `Timeline: ${state.durationSeconds}s, ${state.trackCount} track(s), ${state.itemCount} item(s)`,
    `Canvas: ${state.width}x${state.height} @ ${state.fps}fps`,
    `Selected item: ${state.selectedItemId ?? "none"}`,
  ].join("\n");
}

function loadedState(
  timeline: ImportedTimeline,
  source: EditorSessionSource,
  selectedItemId: string | undefined,
): LoadedEditorSessionState {
  return {
    loaded: true,
    projectTitle: timeline.project.title,
    durationSeconds: timeline.durationSeconds,
    width: timeline.width,
    height: timeline.height,
    fps: timeline.fps,
    trackCount: timeline.tracks.length,
    itemCount: timeline.tracks.reduce((total, track) => total + track.items.length, 0),
    selectedItemId,
    source: { ...source },
    timeline: cloneTimeline(timeline),
  };
}

function cloneTimeline(timeline: ImportedTimeline): ImportedTimeline {
  return JSON.parse(JSON.stringify(timeline)) as ImportedTimeline;
}

function findItem(timeline: ImportedTimeline, itemId: string): ImportedTimelineItem | undefined {
  for (const track of timeline.tracks) {
    const item = track.items.find((candidate) => candidate.id === itemId);
    if (item !== undefined) {
      return item;
    }
  }
  return undefined;
}

function sortTimeline(timeline: ImportedTimeline): void {
  for (const track of timeline.tracks) {
    track.items.sort((left, right) => left.start - right.start || left.id.localeCompare(right.id));
  }
}
