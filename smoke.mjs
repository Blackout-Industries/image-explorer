// Smoke test for the streaming Docker-save tarball parser.
//
// Builds a *synthetic* `docker save`-style tar in memory:
//   - manifest.json      → one entry, refs config.json + 1 layer
//   - <config>.json      → minimal history
//   - layer0.tar         → 2 files
//
// Then feeds the bytes into the same `parseDockerImage` flow the browser uses.
// We patch `File` / `Blob.stream()` so we don't need a DOM.
//
// Run inside the project container:
//   docker run --rm -v "$(pwd)":/app -w /app node:22-alpine \
//     sh -c "npm install --no-audit --no-fund && node smoke.mjs"

import tarStream from 'tar-stream';

// ── Polyfill `File` / `FileList` enough for the parser ─────────────────────
class FakeFile {
  constructor(buf, name) {
    this._buf = buf;
    this.name = name;
    this.size = buf.byteLength;
  }
  stream() {
    const buf = this._buf;
    return new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(buf));
        controller.close();
      },
    });
  }
}
globalThis.File = FakeFile;

// ── Build a single tar from a list of entries → Uint8Array ─────────────────
async function buildTar(entries) {
  const pack = tarStream.pack();
  const chunks = [];
  pack.on('data', (c) => chunks.push(c));
  const done = new Promise((res, rej) => {
    pack.on('end', res);
    pack.on('error', rej);
  });
  for (const e of entries) {
    await new Promise((resolve, reject) => {
      pack.entry({ name: e.name, size: e.data.length, type: e.type ?? 'file', mode: e.mode ?? 0o644 }, e.data, (err) =>
        err ? reject(err) : resolve(),
      );
    });
  }
  pack.finalize();
  await done;
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

const te = new TextEncoder();

async function main() {
  // ── Inner layer tar: 2 files ──
  const layerTar = await buildTar([
    { name: 'etc/hello.txt', data: te.encode('hello world\n') },
    { name: 'usr/bin/dummy', data: te.encode('#!/bin/sh\necho hi\n'), mode: 0o755 },
  ]);

  // ── Image config blob ──
  const config = {
    architecture: 'amd64',
    os: 'linux',
    rootfs: { type: 'layers', diff_ids: ['sha256:deadbeef'] },
    history: [
      { created: '2025-01-01T00:00:00Z', created_by: '/bin/sh -c #(nop) ADD file:abc in /' },
    ],
  };
  const configBytes = te.encode(JSON.stringify(config));
  const configName = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef.json';

  // ── manifest.json ──
  const manifest = [
    {
      Config: configName,
      RepoTags: ['smoke:latest'],
      Layers: ['layer0/layer.tar'],
    },
  ];
  const manifestBytes = te.encode(JSON.stringify(manifest));

  // ── Outer tar ──
  const outerTar = await buildTar([
    { name: 'manifest.json', data: manifestBytes },
    { name: configName, data: configBytes },
    { name: 'layer0/layer.tar', data: layerTar },
  ]);

  // ── Run the parser ──
  // Import after the File polyfill is in place.
  const { parseDockerImage } = await import('./src/lib/image-parse.ts');
  const file = new FakeFile(outerTar, 'smoke.tar');

  const parsed = await parseDockerImage(file, (p) => {
    if (p.phase !== 'parsing-layer') console.log(`[progress] ${p.phase}: ${p.message ?? ''}`);
  });

  // ── Assertions ──
  const ok = [];
  const bad = [];
  const check = (cond, label) => (cond ? ok : bad).push(label);

  check(parsed.layers.length === 1, `layers.length === 1 (got ${parsed.layers.length})`);
  check(parsed.stats.fileCount === 2, `stats.fileCount === 2 (got ${parsed.stats.fileCount})`);
  check(parsed.stats.repoTags[0] === 'smoke:latest', `repoTag matches`);
  check(parsed.files.some((f) => f.path === 'etc/hello.txt'), 'etc/hello.txt present');
  check(parsed.files.some((f) => f.path === 'usr/bin/dummy'), 'usr/bin/dummy present');
  check(parsed.bloat.length === 0, `bloat.length === 0 (got ${parsed.bloat.length})`);
  check(typeof parsed.suggestion.image === 'string', 'suggestion image is string');

  console.log('\n── Smoke results ──');
  for (const l of ok) console.log('  PASS', l);
  for (const l of bad) console.log('  FAIL', l);
  if (bad.length) {
    console.error(`\n${bad.length} assertion(s) failed.`);
    process.exit(1);
  }
  console.log(`\nAll ${ok.length} assertions passed.`);
  console.log('Suggestion image:', parsed.suggestion.image);
  console.log('Detected distro:', parsed.baseImage.distro);
}

main().catch((err) => {
  console.error('Smoke test crashed:', err);
  process.exit(1);
});
