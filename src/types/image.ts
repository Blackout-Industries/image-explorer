// Domain types for the Docker image layer explorer.

export type FileChange = 'added' | 'modified' | 'removed';

/** Single file in a layer's virtual filesystem snapshot. */
export interface VirtualFile {
  /** Absolute path inside the image, no leading slash (e.g. "usr/bin/node"). */
  path: string;
  size: number;
  mode: number;
  /** Layer index where this file was first introduced. */
  addedInLayer: number;
  /** Layer index where this file was last modified (>= addedInLayer). */
  lastModifiedInLayer: number;
  /** If set, the layer index in which this file was removed by a whiteout. */
  removedInLayer?: number;
  isSymlink: boolean;
  linkname?: string;
  isDir: boolean;
}

/** Per-layer delta — the changes this single layer introduced. */
export interface LayerChange {
  path: string;
  kind: FileChange;
  size: number;
  mode: number;
  isDir: boolean;
}

/** Configured-history entry from the image config blob. */
export interface HistoryEntry {
  created?: string;
  created_by?: string;
  comment?: string;
  empty_layer?: boolean;
}

/** A single layer in the image. */
export interface Layer {
  /** 0-based index into the manifest's Layers array. */
  index: number;
  /** Path inside the outer tar (e.g. "blobs/sha256/abc..." or "abc.../layer.tar"). */
  tarPath: string;
  /** Short digest derived from tarPath. */
  digest: string;
  /** Size in bytes of the materialized layer tar (decompressed). */
  size: number;
  /** Command snippet from config.history (after stripping "/bin/sh -c #(nop)" etc.). */
  command: string;
  /** Raw history entry. */
  history?: HistoryEntry;
  /** Per-layer additions/modifications/removals. */
  changes: LayerChange[];
}

/** Aggregate image statistics. */
export interface ImageStats {
  totalSize: number;
  layerCount: number;
  fileCount: number;
  /** Sum of bytes for files added then later removed. */
  potentialSavings: number;
  repoTags: string[];
}

/** A single bloat finding — file added in one layer, removed in a later layer. */
export interface BloatEntry {
  path: string;
  size: number;
  addedInLayer: number;
  removedInLayer: number;
}

/** Parsed image — everything the UI needs. */
export interface ParsedImage {
  stats: ImageStats;
  layers: Layer[];
  /** Final virtual filesystem (after all layers applied). */
  files: VirtualFile[];
  /** Bloat findings (files added then later removed). */
  bloat: BloatEntry[];
  /** Distro/runtime detection. */
  baseImage: BaseImageInfo;
  /** Suggestion built from baseImage. */
  suggestion: DistrolessSuggestion;
  /** Raw config.history (for the layer list to display). */
  history: HistoryEntry[];
}

export interface BaseImageInfo {
  distro?: 'debian' | 'ubuntu' | 'alpine' | 'rocky' | 'fedora' | 'centos' | 'unknown';
  distroVersion?: string;
  prettyName?: string;
  runtimes: Runtime[];
}

export type Runtime =
  | 'nodejs'
  | 'python'
  | 'jvm'
  | 'go'
  | 'ruby'
  | 'rust'
  | 'php'
  | 'dotnet'
  | 'static';

export interface DistrolessSuggestion {
  /** The recommended replacement image ref. */
  image: string;
  /** Short rationale ("Debian + nodejs detected"). */
  reason: string;
  /** Estimated size in MB of the suggested image (rough, illustrative). */
  estimatedSizeMB?: number;
  /** Secondary alternative refs (e.g. Chainguard). */
  alternatives: string[];
}

/** Tree node used by FileTree component. */
export interface TreeNode {
  name: string;
  path: string;
  isDir: boolean;
  /** Kind in the *currently selected layer's delta* — undefined if not in delta. */
  kind?: FileChange;
  size: number;
  mode: number;
  children: TreeNode[];
}

/** Parse progress callback payload. */
export interface ParseProgress {
  phase: 'reading-manifest' | 'parsing-config' | 'parsing-layer' | 'done';
  layerIndex?: number;
  layerCount?: number;
  message?: string;
}
