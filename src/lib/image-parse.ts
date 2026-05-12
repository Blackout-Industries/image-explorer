// Streaming Docker-save tarball parser.
//
// Approach:
// 1. Stream the outer .tar through `tar-stream` (Node-flavored, polyfilled via
//    Vite `buffer` alias + `global: 'globalThis'`).
// 2. On the first pass we extract `manifest.json` + the `<config>.json` blob and
//    cache the *raw bytes* of each layer .tar / .tar.gz blob in memory (one
//    Uint8Array per layer). Outer tar entries arrive in stream order; we don't
//    know which entries are layers vs other blobs until we've read the manifest,
//    so we keep every regular file's bytes keyed by path. This means peak memory
//    is roughly the *uncompressed-on-disk* outer tar — but each layer is read
//    in a single pass, no `readAsArrayBuffer` of the whole 500MB tarball into
//    a single buffer.
// 3. For each layer in manifest order: gunzip (pako) if .tar.gz, then run a
//    second tar-stream pass over those bytes and call `applyLayer()`.
//
// Pure browser — no Node deps at runtime; tar-stream + readable-stream are
// polyfilled by Vite's `buffer` alias and the `global: globalThis` define.

// `tar-stream` exposes the extractor as `extract`. The deep import
// (`tar-stream/extract`) lacks a `.d.ts` shim, so prefer the package entry.
import { extract } from 'tar-stream';
import { inflate, ungzip } from 'pako';
import { Buffer } from 'buffer';
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

// Expose Buffer globally for tar-stream (which does `new Buffer(...)` via
// readable-stream internals).
if (typeof (globalThis as { Buffer?: unknown }).Buffer === 'undefined') {
  (globalThis as { Buffer: typeof Buffer }).Buffer = Buffer;
}

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

interface TarEntryHeader {
  name: string;
  size?: number;
  type?: string;
  mode?: number;
  linkname?: string;
}

interface CapturedEntry {
  header: TarEntryHeader;
  data: Uint8Array;
}

const td = new TextDecoder();

/**
 * Stream a Web ReadableStream (from `File.stream()`) into a tar-stream extractor.
 * `onEntry` is invoked with the *concatenated* entry bytes — tar-stream gives
 * us a Node readable per entry, so we read until end before resolving.
 */
async function streamTar(
  stream: ReadableStream<Uint8Array>,
  onEntry: (e: CapturedEntry) => Promise<void> | void,
): Promise<void> {
  const ex = extract();

  // tar-stream emits 'entry' events; pipe stream bytes into ex via .write().
  const done = new Promise<void>((resolve, reject) => {
    ex.on(
      'entry',
      (
        header: TarEntryHeader,
        entryStream: NodeJS.ReadableStream,
        next: (err?: unknown) => void,
      ) => {
        const chunks: Uint8Array[] = [];
        entryStream.on('data', (c: Uint8Array | Buffer) => {
          // tar-stream gives Buffer; ensure plain Uint8Array.
          chunks.push(c instanceof Uint8Array ? c : new Uint8Array(c));
        });
        entryStream.on('end', () => {
          const data = concat(chunks);
          Promise.resolve(onEntry({ header, data }))
            .then(() => next())
            .catch((err) => {
              next(err);
              reject(err);
            });
        });
        entryStream.on('error', reject);
        entryStream.resume();
      },
    );
    ex.on('finish', () => resolve());
    ex.on('error', reject);
  });

  const reader = stream.getReader();
  try {
    while (true) {
      const { value, done: rdDone } = await reader.read();
      if (rdDone) break;
      if (value) {
        // tar-stream's write returns false if backpressured; we ignore here for
        // simplicity (Node-style 'drain' would be nicer but the polyfill in
        // browser buffers fine for typical image sizes).
        ex.write(Buffer.from(value));
      }
    }
    ex.end();
  } finally {
    reader.releaseLock();
  }

  await done;
}

function concat(chunks: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const c of chunks) total += c.byteLength;
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

/** Strip Docker's "/bin/sh -c #(nop) " noise from a history command. */
export function cleanCommand(cmd: string | undefined): string {
  if (!cmd) return '';
  return cmd
    .replace(/^\/bin\/sh -c #\(nop\)\s*/, '')
    .replace(/^\/bin\/sh -c\s*/, 'RUN ')
    .trim();
}

function shortDigest(tarPath: string): string {
  // tarPath examples: "blobs/sha256/abc123...", "abc123.../layer.tar"
  const m = tarPath.match(/([a-f0-9]{12,64})/);
  return m && m[1] ? m[1].slice(0, 12) : tarPath.slice(0, 12);
}

export async function parseDockerImage(
  file: File,
  onProgress?: (p: ParseProgress) => void,
): Promise<ParsedImage> {
  onProgress?.({ phase: 'reading-manifest', message: 'Reading outer tarball' });

  // Capture all regular-file entries from the outer tar.
  const outerEntries = new Map<string, CapturedEntry>();
  await streamTar(file.stream() as ReadableStream<Uint8Array>, (e) => {
    // Only keep regular files / contiguous files — skip dirs, longlink, etc.
    const t = e.header.type;
    if (t === undefined || t === 'file' || t === 'contiguous-file' || t === '0') {
      // Normalize leading "./"
      const name = e.header.name.replace(/^\.\//, '');
      outerEntries.set(name, { ...e, header: { ...e.header, name } });
    }
  });

  // ── manifest.json ──
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

/** Run tar-stream over already-decompressed layer bytes and apply to fs. */
async function parseLayerTar(
  bytes: Uint8Array,
  layerIndex: number,
  fs: FsState,
) {
  // Build a ReadableStream from the bytes so we can reuse `streamTar`.
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });

  const entries: { header: TarEntryHeader; size: number }[] = [];

  await streamTar(stream, (e) => {
    entries.push({ header: e.header, size: e.data.byteLength });
  });

  return applyLayer(layerIndex, entries, fs);
}
