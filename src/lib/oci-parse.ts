// OCI image-layout tarball parser.
//
// Format reference: https://github.com/opencontainers/image-spec/blob/main/image-layout.md
//
// Inside the outer tar:
//   oci-layout                    JSON: { imageLayoutVersion: "1.0.0" }
//   index.json                    entry point — lists manifests by digest
//   blobs/sha256/<digest>         content-addressed blobs (manifests, configs, layers)
//
// Layer media types we handle:
//   application/vnd.oci.image.layer.v1.tar
//   application/vnd.oci.image.layer.v1.tar+gzip
//   application/vnd.oci.image.layer.v1.tar+zstd            (via fzstd polyfill)
//   application/vnd.docker.image.rootfs.diff.tar.gzip      (Docker-flavored OCI)
//
// Falls back to magic-byte sniffing if the media type is missing.

import { ungzip, inflate } from 'pako';
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
import {
  bytesAsStream,
  streamTar,
  type CapturedEntry,
  type TarEntryHeader,
} from './tar-stream-util';
import { cleanCommand } from './image-parse-util';

interface OciLayout {
  imageLayoutVersion?: string;
}

interface OciDescriptor {
  mediaType?: string;
  digest: string;
  size?: number;
  platform?: { architecture?: string; os?: string };
  annotations?: Record<string, string>;
}

interface OciIndex {
  schemaVersion?: number;
  manifests?: OciDescriptor[];
  annotations?: Record<string, string>;
}

interface OciManifest {
  schemaVersion?: number;
  mediaType?: string;
  config: OciDescriptor;
  layers: OciDescriptor[];
  annotations?: Record<string, string>;
}

interface OciImageConfig {
  architecture?: string;
  os?: string;
  history?: HistoryEntry[];
  config?: Record<string, unknown>;
  rootfs?: { type: string; diff_ids: string[] };
}

const td = new TextDecoder();

/**
 * Resolve `blobs/sha256/<hex>` from a descriptor digest like `sha256:abc...`.
 */
function blobPath(digest: string): string {
  const idx = digest.indexOf(':');
  if (idx < 0) throw new Error(`Bad descriptor digest (no algo prefix): ${digest}`);
  const algo = digest.slice(0, idx);
  const hex = digest.slice(idx + 1);
  return `blobs/${algo}/${hex}`;
}

/** Short 12-char form for display. */
function shortDigest(digest: string): string {
  const idx = digest.indexOf(':');
  const hex = idx >= 0 ? digest.slice(idx + 1) : digest;
  return hex.slice(0, 12);
}

function looksLikeManifest(d: OciDescriptor): boolean {
  if (!d.mediaType) return true; // tolerate missing mediaType
  const m = d.mediaType;
  return (
    m === 'application/vnd.oci.image.manifest.v1+json' ||
    m === 'application/vnd.docker.distribution.manifest.v2+json' ||
    m === 'application/vnd.oci.image.index.v1+json' ||
    m === 'application/vnd.docker.distribution.manifest.list.v2+json'
  );
}

function looksLikeIndex(d: OciDescriptor): boolean {
  const m = d.mediaType ?? '';
  return (
    m === 'application/vnd.oci.image.index.v1+json' ||
    m === 'application/vnd.docker.distribution.manifest.list.v2+json'
  );
}

/**
 * Quick check: does the outer tar look like an OCI image-layout?
 * We accept either `oci-layout` at the root or `./oci-layout`.
 */
export function isOciLayout(outerEntries: Map<string, CapturedEntry>): boolean {
  return outerEntries.has('oci-layout');
}

interface DecompressedLayer {
  bytes: Uint8Array;
  /** Original on-disk size (compressed) for the layer-size column. */
  compressedSize: number;
}

/**
 * Decompress a layer blob given its media type (or sniffed magic bytes).
 * Returns the raw tar bytes.
 */
async function decompressLayer(
  blob: Uint8Array,
  mediaType: string | undefined,
): Promise<Uint8Array> {
  const mt = (mediaType ?? '').toLowerCase();
  const looksGzip =
    blob.length >= 2 && blob[0] === 0x1f && blob[1] === 0x8b;
  const looksZstd =
    blob.length >= 4 &&
    blob[0] === 0x28 &&
    blob[1] === 0xb5 &&
    blob[2] === 0x2f &&
    blob[3] === 0xfd;

  if (mt.endsWith('+gzip') || mt.endsWith('.tar.gzip') || mt.endsWith('.gzip') || looksGzip) {
    try {
      return ungzip(blob);
    } catch {
      return inflate(blob);
    }
  }

  if (mt.endsWith('+zstd') || mt.endsWith('+zstd:chunked') || looksZstd) {
    // Lazy-load fzstd so non-zstd images don't pay the cost.
    try {
      const { decompress } = await import('fzstd');
      return decompress(blob);
    } catch (err) {
      throw new Error(
        'This OCI image has zstd-compressed layers but the zstd decoder failed to load. ' +
          'Try `docker save` (which always produces gzip) as a workaround. ' +
          `Underlying error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // Otherwise assume plain tar.
  return blob;
}

interface LayerTarEntryInfo {
  header: TarEntryHeader;
  size: number;
}

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

/**
 * Parse an OCI image-layout outer tarball.
 *
 * The caller is expected to have already streamed the outer tar into
 * `outerEntries` (we share that pass with the Docker v1.2 detector in
 * `image-parse.ts`).
 */
export async function parseOciImage(
  outerEntries: Map<string, CapturedEntry>,
  onProgress?: (p: ParseProgress) => void,
): Promise<ParsedImage> {
  onProgress?.({ phase: 'reading-manifest', message: 'Reading OCI layout' });

  // ── oci-layout ──
  const layoutEntry = outerEntries.get('oci-layout');
  if (!layoutEntry) throw new Error('oci-layout file missing — not an OCI image tarball');
  const layout = JSON.parse(td.decode(layoutEntry.data)) as OciLayout;
  if (!layout.imageLayoutVersion) {
    // Non-fatal — some tools omit it. Warn via console.
    console.warn('oci-layout has no imageLayoutVersion; continuing best-effort.');
  }

  // ── index.json ──
  const indexEntry = outerEntries.get('index.json');
  if (!indexEntry) throw new Error('index.json missing from OCI tarball');
  const index = JSON.parse(td.decode(indexEntry.data)) as OciIndex;
  if (!index.manifests || index.manifests.length === 0) {
    throw new Error('index.json has no manifests');
  }

  // Pick first manifest. If it's an index (manifest list / multi-arch),
  // descend one level and pick the first child too.
  let topDesc = index.manifests[0]!;
  if (!looksLikeManifest(topDesc)) {
    throw new Error(`First manifest has unexpected mediaType: ${topDesc.mediaType}`);
  }

  let manifestBlobEntry = outerEntries.get(blobPath(topDesc.digest));
  if (!manifestBlobEntry) {
    throw new Error(`Manifest blob ${topDesc.digest} missing from tarball`);
  }

  if (looksLikeIndex(topDesc)) {
    const childIndex = JSON.parse(td.decode(manifestBlobEntry.data)) as OciIndex;
    if (!childIndex.manifests || childIndex.manifests.length === 0) {
      throw new Error('Nested index.json has no manifests');
    }
    topDesc = childIndex.manifests[0]!;
    manifestBlobEntry = outerEntries.get(blobPath(topDesc.digest));
    if (!manifestBlobEntry) {
      throw new Error(`Child manifest blob ${topDesc.digest} missing from tarball`);
    }
  }

  const manifest = JSON.parse(td.decode(manifestBlobEntry.data)) as OciManifest;

  // ── config blob ──
  onProgress?.({ phase: 'parsing-config', message: 'Reading config blob' });
  const configBlobEntry = outerEntries.get(blobPath(manifest.config.digest));
  if (!configBlobEntry) {
    throw new Error(`Config blob ${manifest.config.digest} missing from tarball`);
  }
  const config = JSON.parse(td.decode(configBlobEntry.data)) as OciImageConfig;
  const history = (config.history ?? []).filter((h) => !h.empty_layer);

  // ── layers ──
  const fs: FsState = new Map<string, VirtualFile>();
  const layers: Layer[] = [];

  for (let i = 0; i < manifest.layers.length; i++) {
    const layerDesc = manifest.layers[i]!;
    onProgress?.({
      phase: 'parsing-layer',
      layerIndex: i,
      layerCount: manifest.layers.length,
      message: `Parsing layer ${i + 1} / ${manifest.layers.length}`,
    });

    const path = blobPath(layerDesc.digest);
    const layerBlobEntry = outerEntries.get(path);
    if (!layerBlobEntry) {
      throw new Error(`Layer blob ${layerDesc.digest} missing from tarball`);
    }

    const decompressed: DecompressedLayer = {
      bytes: await decompressLayer(layerBlobEntry.data, layerDesc.mediaType),
      compressedSize: layerBlobEntry.data.byteLength,
    };

    const layerChanges = await parseLayerTar(decompressed.bytes, i, fs);

    layers.push({
      index: i,
      tarPath: path,
      digest: shortDigest(layerDesc.digest),
      // Report compressed (on-disk) size — matches what Docker v1.2 layers show.
      size: decompressed.compressedSize,
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

  // OCI index annotations sometimes carry a ref name; promote it as a "repo tag"
  // so the header chip has something to show.
  const repoTags: string[] = [];
  const refName =
    index.manifests?.[0]?.annotations?.['org.opencontainers.image.ref.name'] ??
    index.annotations?.['org.opencontainers.image.ref.name'];
  if (refName) repoTags.push(refName);

  onProgress?.({ phase: 'done' });

  return {
    stats: {
      totalSize,
      layerCount: layers.length,
      fileCount: files.filter((f) => !f.removedInLayer && !f.isDir).length,
      potentialSavings,
      repoTags,
    },
    layers,
    files,
    bloat,
    baseImage,
    suggestion,
    history,
  };
}
