// Streaming image-tarball parser.
//
// This module is the format dispatcher. It streams the outer tar once,
// captures every regular-file entry's bytes in memory, then sniffs whether the
// archive is:
//
//   * Docker v1.2  — has `manifest.json` at the root, layers live in
//                    per-digest directories (or `blobs/sha256/...`).
//   * OCI layout   — has `oci-layout` at the root and an `index.json` entry
//                    pointing at content-addressed blobs.
//
// Both paths produce the same `ParsedImage` shape so the UI doesn't care.
//
// Pure browser — `tar-stream` + `readable-stream` are polyfilled by Vite's
// `buffer` alias and the `global: globalThis` define. Optional zstd support
// for OCI layers comes from `fzstd` (lazy-loaded by oci-parse.ts).

import { inflate, ungzip } from 'pako';
import type {
  HistoryEntry,
  Layer,
  ParseProgress,
  ParsedImage,
  VirtualFile,
} from '@/types/image';
import { applyLayer, finalizeFilesystem, type FsState } from './layer-apply';
import { detectBloat } from './bloat-detect';
import { detectBaseImage, suggestDistroless } from './base-image-detect';
import { cleanCommand } from './image-parse-util';
import {
  streamTar,
  bytesAsStream,
  type CapturedEntry,
  type TarEntryHeader,
} from './tar-stream-util';
import { isOciLayout, parseOciImage } from './oci-parse';

interface DockerManifestEntry {
  Config: string;
  RepoTags?: string[];
  Layers: string[];
}

interface ImageConfig {
  history?: HistoryEntry[];
  config?: Record<string, unknown>;
  rootfs?: { type: string; diff_ids: string[] };
}

const td = new TextDecoder();

function shortDigest(tarPath: string): string {
  // tarPath examples: "blobs/sha256/abc123...", "abc123.../layer.tar"
  const m = tarPath.match(/([a-f0-9]{12,64})/);
  return m && m[1] ? m[1].slice(0, 12) : tarPath.slice(0, 12);
}

// Re-export so existing callers / tests that imported it from here keep working.
export { cleanCommand };

/**
 * Parse a Docker v1.2 or OCI image tarball into a `ParsedImage`. The format
 * is auto-detected from the outer tar's root entries.
 */
export async function parseDockerImage(
  file: File | Blob | { stream: () => ReadableStream<Uint8Array> },
  onProgress?: (p: ParseProgress) => void,
): Promise<ParsedImage> {
  onProgress?.({ phase: 'reading-manifest', message: 'Reading outer tarball' });

  // Capture all regular-file entries from the outer tar.
  const outerEntries = new Map<string, CapturedEntry>();
  await streamTar(file.stream() as ReadableStream<Uint8Array>, (e) => {
    const t = e.header.type;
    if (t === undefined || t === 'file' || t === 'contiguous-file' || t === '0') {
      const name = e.header.name.replace(/^\.\//, '');
      outerEntries.set(name, { ...e, header: { ...e.header, name } });
    }
  });

  // ── Dispatch ──
  if (isOciLayout(outerEntries)) {
    return parseOciImage(outerEntries, onProgress);
  }
  if (outerEntries.has('manifest.json')) {
    return parseDockerV1_2(outerEntries, onProgress);
  }
  throw new Error(
    'Unrecognized tarball — expected either `manifest.json` (Docker v1.2 `docker save`) ' +
      'or `oci-layout` (OCI image layout) at the root.',
  );
}

/**
 * Parse a Docker v1.2 (`docker save`) tarball given a fully captured outer
 * entry map. Pulled out of `parseDockerImage` so the OCI dispatcher path can
 * share the outer-tar streaming pass.
 */
async function parseDockerV1_2(
  outerEntries: Map<string, CapturedEntry>,
  onProgress?: (p: ParseProgress) => void,
): Promise<ParsedImage> {
  const manifestEntry = outerEntries.get('manifest.json');
  if (!manifestEntry) {
    throw new Error(
      'manifest.json not found in tarball — is this really a `docker save` archive?',
    );
  }
  const manifest = JSON.parse(td.decode(manifestEntry.data)) as DockerManifestEntry[];
  if (!manifest.length || !manifest[0]) throw new Error('Empty manifest.json');
  const mEntry: DockerManifestEntry = manifest[0]; // pick first manifest (multi-arch out of scope)

  // ── config.json ──
  onProgress?.({ phase: 'parsing-config', message: 'Reading config blob' });
  const configEntry = outerEntries.get(mEntry.Config);
  if (!configEntry) throw new Error(`Config blob ${mEntry.Config} missing from tarball`);
  const config = JSON.parse(td.decode(configEntry.data)) as ImageConfig;
  const history = (config.history ?? []).filter((h) => !h.empty_layer);

  // ── layers ──
  const fs: FsState = new Map<string, VirtualFile>();
  const layers: Layer[] = [];

  for (let i = 0; i < mEntry.Layers.length; i++) {
    const layerPath = mEntry.Layers[i];
    if (!layerPath) continue;
    onProgress?.({
      phase: 'parsing-layer',
      layerIndex: i,
      layerCount: mEntry.Layers.length,
      message: `Parsing layer ${i + 1} / ${mEntry.Layers.length}`,
    });

    const layerEntry = outerEntries.get(layerPath);
    if (!layerEntry) throw new Error(`Layer blob ${layerPath} missing from tarball`);

    // Decompress if gzipped (magic bytes 1f 8b) or .tar.gz path.
    let layerTarBytes = layerEntry.data;
    const isGzip =
      layerPath.endsWith('.gz') ||
      (layerTarBytes.length >= 2 &&
        layerTarBytes[0] === 0x1f &&
        layerTarBytes[1] === 0x8b);
    if (isGzip) {
      try {
        layerTarBytes = ungzip(layerTarBytes);
      } catch {
        layerTarBytes = inflate(layerEntry.data);
      }
    }

    const layerChanges = await parseLayerTar(layerTarBytes, i, fs);

    layers.push({
      index: i,
      tarPath: layerPath,
      digest: shortDigest(layerPath),
      size: layerTarBytes.byteLength,
      command: cleanCommand(history[i]?.created_by),
      history: history[i],
      changes: layerChanges,
    });
  }

  const files = finalizeFilesystem(fs);
  const totalSize = layers.reduce((acc, l) => acc + l.size, 0);
  const bloat = detectBloat(files);
  const potentialSavings = bloat.reduce((acc, b) => acc + b.size, 0);

  const baseImage = detectBaseImage(files, history);
  const suggestion = suggestDistroless(baseImage);

  onProgress?.({ phase: 'done' });

  return {
    stats: {
      totalSize,
      layerCount: layers.length,
      fileCount: files.filter((f) => !f.removedInLayer && !f.isDir).length,
      potentialSavings,
      repoTags: mEntry.RepoTags ?? [],
    },
    layers,
    files,
    bloat,
    baseImage,
    suggestion,
    history,
  };
}

interface LayerTarEntryInfo {
  header: TarEntryHeader;
  size: number;
}

/** Run tar-stream over already-decompressed layer bytes and apply to fs. */
async function parseLayerTar(
  bytes: Uint8Array,
  layerIndex: number,
  fs: FsState,
) {
  const entries: LayerTarEntryInfo[] = [];

  await streamTar(bytesAsStream(bytes), (e) => {
    entries.push({ header: e.header, size: e.data.byteLength });
  });

  return applyLayer(layerIndex, entries, fs);
}
