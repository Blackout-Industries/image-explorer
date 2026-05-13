# Container Image Layer Explorer (Web Dive) — Tool Brief

**Folder:** `image-explorer/` → future repo `Blackout-Industries/image-explorer` → GitHub Pages `https://blackout-industries.github.io/image-explorer/`

## What it is

Web-based equivalent of [`dive`](https://github.com/wagoodman/dive). Upload a saved Docker image tarball (`docker save IMAGE -o image.tar`), explore layers, see what each `RUN` instruction added, identify bloat (files added and then deleted in a later layer), and get distroless/Chainguard alternative suggestions for the base image.

## MVP scope

**Input:**
- Upload `.tar` (Docker save format) — drag-drop / button / paste-file
- Show "How to get this: `docker save myimage:tag -o myimage.tar`" hint

**Layout (three panes, dive-inspired):**

### Pane 1: Layer list (left)
- One row per layer
- Shows: layer index, size, command snippet (from history), digest (short)
- Color band by size (small = green, large = red)
- Selecting a layer drives Panes 2 + 3

### Pane 2: File tree (middle)
- Tree view of the **changes introduced by the selected layer** (added/modified/removed files)
- Color-coded: green = added, yellow = modified, red = removed
- Expand/collapse directories
- Per-file: size, mode (rwxr-xr-x)

### Pane 3: Inspector (right)
- Selected file: full path, layer it was introduced in, layer it was last modified in, current size, deleted-in-later-layer indicator
- Aggregate stats at top: total image size, sum-of-layer-size, "potential savings" (sum of files added then later removed)
- Distroless/Chainguard suggestion: match base image OS detected from `/etc/os-release` in layer 0 (e.g. "Debian bookworm + Node 20 detected — try `gcr.io/distroless/nodejs20-debian12` or `chainguard/node`")

## Parsing logic

Docker save tar format (OCI / Docker v1.2):
1. Top-level `manifest.json` → array of `{Config, RepoTags, Layers}`
2. `Config` is a JSON blob with `history` (layer-by-layer commands)
3. Each `Layers` entry is a path to a `.tar` or `.tar.gz` blob inside the outer tarball
4. Each layer tar uses **whiteout files** (`.wh.*` and `.wh..wh..opq`) to encode deletions

Parsing flow:
1. Outer tar streamed via `tar-stream`
2. Read `manifest.json`, then `<config-digest>.json`
3. For each layer in order:
   - Gunzip via `pako` if `.tar.gz`
   - Stream layer tar via `tar-stream`
   - Build a virtual filesystem state, applying additions, modifications, whiteouts
   - Track per-layer changes (delta)
4. After all layers processed: compute aggregate stats, identify bloat (files in delta_n marked deleted that were added in delta_m where m < n)

**Must stream — image tarballs can be 500MB+. Use `ReadableStream`/`File.stream()`, NOT `FileReader.readAsArrayBuffer()`.**

## Distroless suggestion logic

`src/lib/base-image-detect.ts`:
- Read `/etc/os-release` from layer 0 → distro (debian, alpine, ubuntu, rocky)
- Scan layer commands in `history` for hints: `apt-get install nodejs`, `npm`, `python3`, `go`, `ruby`, `java` (look for `JAVA_HOME` env)
- Map detected (distro, runtime) → distroless image suggestion:
  - debian + nodejs → `gcr.io/distroless/nodejs20-debian12`
  - debian + python → `gcr.io/distroless/python3-debian12`
  - debian + jvm → `gcr.io/distroless/java21-debian12`
  - debian + static binary (go/rust) → `gcr.io/distroless/static-debian12`
  - alpine + any → `chainguard/<runtime>:latest` (Chainguard prefers Wolfi)
- Show as suggestion card, not a hard recommendation

## Flagship scenario for verification

User runs `docker save node:20 -o node20.tar` and uploads. Tool shows:
- 7–8 layers
- Largest layer: the npm install / base packages layer (~400MB)
- Distroless suggestion: `gcr.io/distroless/nodejs20-debian12` (~120MB)
- Bloat detected: ~30MB of apt cache files added in layer N then removed in layer N+1

## Specific deps

```json
"tar-stream": "^3.1.7",
"pako": "^2.1.0",
"@types/pako": "^2.0.3",
"buffer": "^6.0.3"
```

(Note: `tar-stream` is Node-flavored but works in browser with the `buffer` polyfill via Vite's `define`/`alias`. Verify in builder phase; if not, swap to `js-untar` or hand-roll a streaming tar parser.)

## Files to produce

- `src/types/image.ts` — `Layer`, `VirtualFile`, `ImageStats`, `BloatEntry`
- `src/lib/image-parse.ts` — orchestrates streaming parse of outer tarball
- `src/lib/layer-apply.ts` — applies one layer's tar to the virtual filesystem (handles whiteouts)
- `src/lib/bloat-detect.ts` — finds add-then-delete patterns
- `src/lib/base-image-detect.ts` — distro/runtime detection + suggestion
- `src/components/{Upload, LayerList, FileTree, Inspector, BloatSummary, DistrolessSuggestion}.tsx`

## Reuse from kpod

- Theme + palette (could lean into a darker, terminal-y aesthetic for this one)
- Drag-drop upload pattern

## Out of scope for v0

- ~~Pulling images directly from a registry by ref (`nginx:1.25`)~~ — implemented via the `image-pull-proxy` companion service (local-only Node proxy).
- ~~OCI image tarball format~~ — `src/lib/oci-parse.ts` now handles OCI image-layout tarballs alongside Docker v1.2.
- Multi-arch manifest list handling: the SPA picks the first manifest from a list; the pull proxy picks the requested platform.
- Signature verification (sigstore/cosign)
- SBOM extraction from labels
