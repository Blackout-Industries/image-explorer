// Local-only registry proxy for image-explorer.
//
// HTTP API:
//   GET /pull?image=<ref>&platform=<linux/amd64|linux/arm64>
//   GET /healthz
//
// Behaviour:
//   1. Parse the image ref (defaults to docker.io/library if no host).
//   2. Negotiate anonymous bearer-token auth for the registry.
//   3. Fetch the manifest. If it's a manifest list / OCI index, pick the
//      requested platform (or fall back to linux/amd64).
//   4. Fetch the config blob and every layer blob.
//   5. Stream an OCI image-layout tarball back to the client. The SPA's OCI
//      parser then walks it like any other tarball.
//
// This service is intended to run locally — `docker compose up image-pull-proxy`.
// CORS is permissive (*) since it has no auth and binds to localhost.

import http from 'node:http';
import { createHash } from 'node:crypto';
import { fetch } from 'undici';
import tarStream from 'tar-stream';

const PORT = Number(process.env.PORT ?? 5099);
const DEFAULT_PLATFORM = process.env.DEFAULT_PLATFORM ?? 'linux/amd64';

const ACCEPT_MANIFEST = [
  'application/vnd.oci.image.manifest.v1+json',
  'application/vnd.oci.image.index.v1+json',
  'application/vnd.docker.distribution.manifest.v2+json',
  'application/vnd.docker.distribution.manifest.list.v2+json',
].join(', ');

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

/**
 * Parse an image ref into { registry, repository, reference }.
 * `nginx`               → docker.io/library/nginx:latest
 * `nginx:1.27`          → docker.io/library/nginx:1.27
 * `library/nginx:1.27`  → docker.io/library/nginx:1.27
 * `ghcr.io/o/r:tag`     → ghcr.io/o/r:tag
 * `quay.io/o/r@sha256:..` → quay.io/o/r@sha256:..
 */
function parseRef(input) {
  let ref = String(input ?? '').trim();
  if (!ref) throw new Error('image ref required');

  // Split off digest or tag.
  let reference = 'latest';
  const atIdx = ref.indexOf('@');
  if (atIdx >= 0) {
    reference = ref.slice(atIdx + 1);
    ref = ref.slice(0, atIdx);
  } else {
    // Find the LAST colon that isn't part of a host:port.
    // Heuristic: if there's a slash after the last colon, the colon is the port.
    const lastColon = ref.lastIndexOf(':');
    const lastSlash = ref.lastIndexOf('/');
    if (lastColon > lastSlash && lastColon >= 0) {
      reference = ref.slice(lastColon + 1);
      ref = ref.slice(0, lastColon);
    }
  }

  // Decide if the first path segment is a registry host.
  const firstSlash = ref.indexOf('/');
  let registry;
  let repository;
  if (firstSlash < 0) {
    registry = 'docker.io';
    repository = `library/${ref}`;
  } else {
    const head = ref.slice(0, firstSlash);
    const isHost = head.includes('.') || head.includes(':') || head === 'localhost';
    if (isHost) {
      registry = head;
      repository = ref.slice(firstSlash + 1);
    } else {
      // No host, e.g. `library/nginx` or `someuser/someimage` → Docker Hub.
      registry = 'docker.io';
      repository = ref;
    }
  }

  return { registry, repository, reference };
}

/**
 * Resolve the actual HTTPS endpoint for a registry. Docker Hub uses
 * `registry-1.docker.io` for the v2 API.
 */
function registryEndpoint(registry) {
  if (registry === 'docker.io') return 'https://registry-1.docker.io';
  return `https://${registry}`;
}

/**
 * Negotiate an anonymous bearer token for the given repo.
 *
 * Docker Hub uses auth.docker.io. GHCR and quay.io use their own endpoints —
 * we hit /v2/ first, parse the WWW-Authenticate challenge, then request the
 * token.
 */
async function getAuthToken(registry, repository) {
  const endpoint = registryEndpoint(registry);
  const pingRes = await fetch(`${endpoint}/v2/`, { method: 'GET' });
  if (pingRes.status === 200) return null; // unauthenticated registry
  if (pingRes.status !== 401) {
    throw new Error(`Registry ping returned ${pingRes.status}`);
  }
  const challenge = pingRes.headers.get('www-authenticate') ?? '';
  if (!challenge.toLowerCase().startsWith('bearer ')) {
    throw new Error(`Unexpected auth scheme: ${challenge}`);
  }

  // Parse `Bearer realm="...",service="...",scope="..."` into a map.
  const params = {};
  for (const part of challenge.slice('Bearer '.length).split(',')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim().toLowerCase();
    let v = part.slice(eq + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    params[k] = v;
  }
  if (!params.realm) throw new Error('Auth challenge missing realm');

  const scope = params.scope ?? `repository:${repository}:pull`;
  const u = new URL(params.realm);
  if (params.service) u.searchParams.set('service', params.service);
  u.searchParams.set('scope', scope);

  const tokenRes = await fetch(u, {
    headers: { accept: 'application/json' },
  });
  if (!tokenRes.ok) {
    throw new Error(`Auth token request failed: ${tokenRes.status}`);
  }
  const tokenJson = await tokenRes.json();
  const token = tokenJson.token ?? tokenJson.access_token;
  if (!token) throw new Error('Auth response had no token');
  return token;
}

function authHeaders(token) {
  return token ? { authorization: `Bearer ${token}` } : {};
}

async function fetchManifest(registry, repository, reference, token) {
  const endpoint = registryEndpoint(registry);
  const url = `${endpoint}/v2/${repository}/manifests/${encodeURIComponent(reference)}`;
  const res = await fetch(url, {
    headers: { ...authHeaders(token), accept: ACCEPT_MANIFEST },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Manifest fetch failed (${res.status}): ${body.slice(0, 200)}`);
  }
  const mediaType =
    res.headers.get('content-type')?.split(';')[0]?.trim() ?? '';
  const bytes = Buffer.from(await res.arrayBuffer());
  const digestHeader = res.headers.get('docker-content-digest');
  const digest = digestHeader ?? `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  return { bytes, mediaType, digest };
}

async function fetchBlob(registry, repository, digest, token) {
  const endpoint = registryEndpoint(registry);
  const url = `${endpoint}/v2/${repository}/blobs/${digest}`;
  const res = await fetch(url, { headers: authHeaders(token) });
  if (!res.ok) {
    throw new Error(`Blob ${digest} fetch failed: ${res.status}`);
  }
  // Verify the digest matches what the registry served.
  const bytes = Buffer.from(await res.arrayBuffer());
  const want = digest.startsWith('sha256:') ? digest.slice('sha256:'.length) : '';
  if (want) {
    const got = createHash('sha256').update(bytes).digest('hex');
    if (got !== want) {
      throw new Error(`Blob ${digest} digest mismatch (got sha256:${got})`);
    }
  }
  return bytes;
}

function pickPlatform(indexJson, platform) {
  const [os, arch] = platform.split('/');
  const manifests = indexJson.manifests ?? [];
  const match = manifests.find(
    (m) => m.platform?.os === os && m.platform?.architecture === arch,
  );
  if (match) return match;
  // Fallback: first linux/amd64, then first non-attestation entry, then first.
  const amd64 = manifests.find(
    (m) => m.platform?.os === 'linux' && m.platform?.architecture === 'amd64',
  );
  if (amd64) return amd64;
  const nonAttestation = manifests.find(
    (m) => !m.annotations?.['vnd.docker.reference.type'],
  );
  return nonAttestation ?? manifests[0];
}

/**
 * Build and stream an OCI image-layout tarball to `res`.
 * Entries (in order):
 *   oci-layout
 *   index.json
 *   blobs/sha256/<manifest>
 *   blobs/sha256/<config>
 *   blobs/sha256/<layer-0..N>
 */
function streamOciTar(res, parts) {
  const pack = tarStream.pack();
  pack.pipe(res);

  const queue = [
    { name: 'oci-layout', data: Buffer.from(JSON.stringify({ imageLayoutVersion: '1.0.0' })) },
    { name: 'index.json', data: parts.indexJson },
    { name: `blobs/sha256/${parts.manifestDigest}`, data: parts.manifestBytes },
    { name: `blobs/sha256/${parts.configDigest}`, data: parts.configBytes },
    ...parts.layers.map((l) => ({
      name: `blobs/sha256/${l.digest}`,
      data: l.bytes,
    })),
  ];

  return new Promise((resolve, reject) => {
    let i = 0;
    const next = () => {
      if (i >= queue.length) {
        pack.finalize();
        resolve();
        return;
      }
      const entry = queue[i++];
      pack.entry(
        { name: entry.name, size: entry.data.length },
        entry.data,
        (err) => (err ? reject(err) : next()),
      );
    };
    next();
  });
}

async function handlePull(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const image = url.searchParams.get('image');
  const platform = url.searchParams.get('platform') ?? DEFAULT_PLATFORM;
  if (!image) {
    res.writeHead(400, { 'content-type': 'application/json', ...corsHeaders });
    res.end(JSON.stringify({ error: 'missing image param' }));
    return;
  }

  let parsed;
  try {
    parsed = parseRef(image);
  } catch (err) {
    res.writeHead(400, { 'content-type': 'application/json', ...corsHeaders });
    res.end(JSON.stringify({ error: err.message }));
    return;
  }

  const { registry, repository, reference } = parsed;
  console.log(`[pull] ${registry}/${repository}:${reference} (${platform})`);

  try {
    const token = await getAuthToken(registry, repository);

    // Top-level manifest.
    let m = await fetchManifest(registry, repository, reference, token);
    let manifestJson = JSON.parse(m.bytes.toString('utf8'));
    const isIndex =
      m.mediaType === 'application/vnd.oci.image.index.v1+json' ||
      m.mediaType === 'application/vnd.docker.distribution.manifest.list.v2+json' ||
      Array.isArray(manifestJson.manifests);

    if (isIndex) {
      const picked = pickPlatform(manifestJson, platform);
      if (!picked) throw new Error('No platform-matching manifest in index');
      m = await fetchManifest(registry, repository, picked.digest, token);
      manifestJson = JSON.parse(m.bytes.toString('utf8'));
    }

    // Rewrite the manifest to a clean OCI manifest so the SPA's parser is
    // happy regardless of whether the registry served Docker or OCI media
    // types. We also recompute the digest of the rewritten manifest because
    // the SPA validates `blobs/sha256/<digest>` against the descriptors.
    const cleanManifest = {
      schemaVersion: 2,
      mediaType: 'application/vnd.oci.image.manifest.v1+json',
      config: {
        mediaType: 'application/vnd.oci.image.config.v1+json',
        digest: manifestJson.config.digest,
        size: manifestJson.config.size,
      },
      layers: manifestJson.layers.map((l) => ({
        mediaType: dockerToOciLayerMediaType(l.mediaType),
        digest: l.digest,
        size: l.size,
      })),
    };
    const manifestBytes = Buffer.from(JSON.stringify(cleanManifest));
    const manifestDigest = createHash('sha256').update(manifestBytes).digest('hex');

    // Pull config blob.
    const configBytes = await fetchBlob(
      registry,
      repository,
      cleanManifest.config.digest,
      token,
    );
    const configDigest = cleanManifest.config.digest.slice('sha256:'.length);

    // Pull every layer blob.
    const layers = [];
    for (const l of cleanManifest.layers) {
      const bytes = await fetchBlob(registry, repository, l.digest, token);
      layers.push({ digest: l.digest.slice('sha256:'.length), bytes });
    }

    // Build the index.json for the tarball, pointing at the rewritten manifest.
    const indexJson = Buffer.from(
      JSON.stringify({
        schemaVersion: 2,
        manifests: [
          {
            mediaType: 'application/vnd.oci.image.manifest.v1+json',
            digest: `sha256:${manifestDigest}`,
            size: manifestBytes.length,
            annotations: {
              'org.opencontainers.image.ref.name': `${registry}/${repository}:${reference}`,
            },
          },
        ],
      }),
    );

    res.writeHead(200, {
      'content-type': 'application/x-tar',
      ...corsHeaders,
    });

    await streamOciTar(res, {
      indexJson,
      manifestBytes,
      manifestDigest,
      configBytes,
      configDigest,
      layers,
    });
  } catch (err) {
    console.error('[pull] error', err);
    if (!res.headersSent) {
      res.writeHead(502, { 'content-type': 'application/json', ...corsHeaders });
      res.end(JSON.stringify({ error: err.message ?? String(err) }));
    } else {
      try {
        res.end();
      } catch {}
    }
  }
}

/**
 * Normalize Docker-flavoured layer media types to their OCI equivalents.
 */
function dockerToOciLayerMediaType(mt) {
  if (!mt) return 'application/vnd.oci.image.layer.v1.tar';
  if (mt === 'application/vnd.docker.image.rootfs.diff.tar.gzip') {
    return 'application/vnd.oci.image.layer.v1.tar+gzip';
  }
  if (mt === 'application/vnd.docker.image.rootfs.diff.tar') {
    return 'application/vnd.oci.image.layer.v1.tar';
  }
  return mt;
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders);
    res.end();
    return;
  }
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json', ...corsHeaders });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  if (url.pathname === '/pull' && req.method === 'GET') {
    handlePull(req, res);
    return;
  }
  res.writeHead(404, { 'content-type': 'application/json', ...corsHeaders });
  res.end(JSON.stringify({ error: 'not found' }));
});

server.listen(PORT, () => {
  console.log(`image-pull-proxy listening on :${PORT}`);
});
