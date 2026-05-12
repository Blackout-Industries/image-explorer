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

## What it does

- Three-pane layout: layer list, per-layer file delta, inspector.
- Size band per layer (green / yellow / red).
- Handles whiteouts (`.wh.<name>`) and opaque directory markers (`.wh..wh..opq`).
- Flags bloat: files added in one layer and removed in a later one (reclaimable bytes).
- Suggests a distroless or Chainguard base image based on detected distro + runtime.
- Streaming parser via `File.stream()` + `tar-stream`. Doesn't slurp the whole tarball into memory.

## Quick start

```bash
docker compose up
# open http://localhost:5173
```

Non-Docker: `npm install && npm run dev`.

## Tech

| Layer | What |
|-------|------|
| Framework | React 19 + TypeScript strict |
| Build | Vite 6 |
| Styling | Tailwind v4 |
| Tar parsing | tar-stream (browser-polyfilled) |
| Decompress | pako |

## Limits

- Docker v1.2 tarballs only. No OCI image-tarball format yet.
- No registry pulls by ref. Needs a CORS-bypass backend; not v0.
- Multi-arch manifest lists: we pick the first manifest.
- No signature / SBOM verification (sigstore, cosign).

## Versioning

[SemVer](https://semver.org), computed by [GitVersion](https://gitversion.net) from git tags on every push to `main`.

## License

MIT — see LICENSE.
