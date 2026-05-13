# image-explorer

`docker save` your image, drop the tarball here. Web version of `dive`. No registry pulls, no backend.

[![CI](https://github.com/Blackout-Industries/image-explorer/actions/workflows/ci.yml/badge.svg)](https://github.com/Blackout-Industries/image-explorer/actions/workflows/ci.yml)
[![Deploy](https://github.com/Blackout-Industries/image-explorer/actions/workflows/pages.yml/badge.svg)](https://github.com/Blackout-Industries/image-explorer/actions/workflows/pages.yml)
[![CodeQL](https://github.com/Blackout-Industries/image-explorer/actions/workflows/codeql.yml/badge.svg)](https://github.com/Blackout-Industries/image-explorer/actions/workflows/codeql.yml)
[![Trivy](https://github.com/Blackout-Industries/image-explorer/actions/workflows/trivy.yml/badge.svg)](https://github.com/Blackout-Industries/image-explorer/actions/workflows/trivy.yml)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/Blackout-Industries/image-explorer/badge)](https://scorecard.dev/viewer/?uri=github.com/Blackout-Industries/image-explorer)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

Live demo: https://blackout-industries.github.io/image-explorer/

```
$ docker save myimage:tag -o myimage.tar
$ open https://blackout-industries.github.io/image-explorer/
$ # drop the tar, walk the layers
```

Or pull straight from a registry through the companion proxy:

```
$ docker compose up image-pull-proxy
$ # in the SPA: type `nginx:1.27`, hit Fetch.
```

## What it does

- Three-pane layout: layer list, per-layer file delta, inspector.
- Size band per layer (green / yellow / red).
- Handles whiteouts (`.wh.<name>`) and opaque directory markers (`.wh..wh..opq`).
- Flags bloat: files added in one layer and removed in a later one (reclaimable bytes).
- Suggests a distroless or Chainguard base image based on detected distro + runtime.
- Reads **Docker v1.2** (`docker save`) and **OCI image-layout** tarballs. Gzip and zstd layers both supported.
- Optional **pull-by-ref** via the local `image-pull-proxy` companion service — Docker Hub, GHCR, Quay, anything OCI.
- Streaming parser via `File.stream()` + `tar-stream`. Doesn't slurp the whole tarball into memory.

## Quick start

```bash
docker compose up
# open http://localhost:5173
```

Non-Docker: `npm install && npm run dev`.

### Pull-by-ref proxy

The SPA can fetch images by reference (`nginx:1.27`, `ghcr.io/owner/repo:tag`, etc.) through a tiny local
proxy. It negotiates anonymous registry auth, fetches the manifest + config + layer blobs, and streams
an OCI tarball back to the browser.

```bash
docker compose up image-pull-proxy        # listens on http://localhost:5099
```

The proxy is local-only — no public hosting. If it isn't running the SPA falls back gracefully and you
can still drop a `docker save` tarball.

## Tech

| Layer | What |
|-------|------|
| Framework | React 19 + TypeScript strict |
| Build | Vite 6 |
| Styling | Tailwind v4 |
| Tar parsing | tar-stream (browser-polyfilled) |
| Decompress | pako |

## Limits

- Multi-arch manifest lists: the SPA picks the first manifest; the pull proxy picks the requested platform (or falls back to `linux/amd64`).
- The pull proxy buffers each blob fully in memory before forwarding — fine for typical images, less great for multi-GB monsters.
- No signature / SBOM verification (sigstore, cosign).
- zstd:chunked layers are decoded as plain zstd (no random-access optimisation).

## Versioning

[SemVer](https://semver.org), computed by [GitVersion](https://gitversion.net) from git tags on every push to `main`.

## License

MIT — see LICENSE.
