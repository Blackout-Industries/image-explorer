// Shared tar-stream helpers used by both the Docker v1.2 and OCI image-tarball
// parsers. Keeps the `tar-stream` polyfill plumbing in one place.

import { extract } from 'tar-stream';
import { Buffer } from 'buffer';

// tar-stream / readable-stream both poke at globalThis.Buffer; make sure it's
// available before either parser runs.
if (typeof (globalThis as { Buffer?: unknown }).Buffer === 'undefined') {
  (globalThis as { Buffer: typeof Buffer }).Buffer = Buffer;
}

export interface TarEntryHeader {
  name: string;
  size?: number;
  type?: string;
  mode?: number;
  linkname?: string;
}

export interface CapturedEntry {
  header: TarEntryHeader;
  data: Uint8Array;
}

/**
 * Concatenate a list of Uint8Array chunks into a single buffer.
 */
export function concat(chunks: Uint8Array[]): Uint8Array {
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

/**
 * Pipe a Web `ReadableStream<Uint8Array>` into `tar-stream`'s extractor,
 * invoking `onEntry` for each tar entry with its concatenated bytes.
 *
 * tar-stream is Node-style; the polyfill in Vite's `buffer` alias plus
 * `events`/`process` shims lets it run unchanged in the browser.
 */
export async function streamTar(
  stream: ReadableStream<Uint8Array>,
  onEntry: (e: CapturedEntry) => Promise<void> | void,
): Promise<void> {
  const ex = extract();

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
        ex.write(Buffer.from(value));
      }
    }
    ex.end();
  } finally {
    reader.releaseLock();
  }

  await done;
}

/**
 * Wrap an in-memory Uint8Array as a single-chunk Web ReadableStream so it can
 * be fed to `streamTar` like any other source.
 */
export function bytesAsStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}
