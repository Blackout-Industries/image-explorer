// Detect the base image's distro + runtime, then map to a distroless or
// Chainguard alternative suggestion.

import type {
  BaseImageInfo,
  DistrolessSuggestion,
  HistoryEntry,
  Runtime,
  VirtualFile,
} from '@/types/image';

interface OsRelease {
  ID?: string;
  VERSION_ID?: string;
  VERSION_CODENAME?: string;
  PRETTY_NAME?: string;
}

/** Quick & dirty parser for /etc/os-release `KEY=VALUE` files. */
function parseOsRelease(content: string): OsRelease {
  const out: OsRelease = {};
  for (const lineRaw of content.split('\n')) {
    const line = lineRaw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    (out as Record<string, string>)[key] = value;
  }
  return out;
}

function normalizeDistro(id: string | undefined): BaseImageInfo['distro'] {
  if (!id) return 'unknown';
  const lower = id.toLowerCase();
  if (lower.includes('debian')) return 'debian';
  if (lower.includes('ubuntu')) return 'ubuntu';
  if (lower.includes('alpine')) return 'alpine';
  if (lower.includes('rocky')) return 'rocky';
  if (lower.includes('fedora')) return 'fedora';
  if (lower.includes('centos')) return 'centos';
  return 'unknown';
}

/**
 * `/etc/os-release` is a regular file in the image; we don't keep file content
 * during the streaming pass (only sizes). For v0 we infer the distro from the
 * *presence* of well-known marker files instead. This is good enough for the
 * suggestion card; a future version could read /etc/os-release contents for a
 * precise distro version.
 *
 * We accept an optional `osReleaseContent` for cases where the parser is
 * extended to capture small files like /etc/os-release into memory.
 */
export function detectBaseImage(
  files: VirtualFile[],
  history: HistoryEntry[],
  osReleaseContent?: string,
): BaseImageInfo {
  let distro: BaseImageInfo['distro'] = 'unknown';
  let distroVersion: string | undefined;
  let prettyName: string | undefined;

  if (osReleaseContent) {
    const parsed = parseOsRelease(osReleaseContent);
    distro = normalizeDistro(parsed.ID);
    distroVersion = parsed.VERSION_ID ?? parsed.VERSION_CODENAME;
    prettyName = parsed.PRETTY_NAME;
  } else {
    // Heuristic markers — order matters.
    const has = (path: string) =>
      files.some((f) => f.path === path && f.removedInLayer === undefined);
    if (has('etc/alpine-release')) distro = 'alpine';
    else if (has('etc/debian_version')) {
      // Ubuntu derives from Debian and also has etc/debian_version — check for
      // ubuntu-specific markers first.
      if (
        files.some(
          (f) =>
            f.path.startsWith('etc/lsb-release') ||
            f.path === 'etc/update-motd.d/00-header',
        )
      ) {
        distro = 'ubuntu';
      } else {
        distro = 'debian';
      }
    } else if (has('etc/redhat-release')) distro = 'rocky';
    else if (has('etc/fedora-release')) distro = 'fedora';
    else if (has('etc/centos-release')) distro = 'centos';
  }

  // ── Runtime detection ──
  const runtimes = new Set<Runtime>();
  const cmds = history.map((h) => (h.created_by ?? '').toLowerCase()).join('\n');

  const hasFile = (re: RegExp) =>
    files.some((f) => re.test(f.path) && f.removedInLayer === undefined);

  if (
    /\bnodejs\b|\bnode\b/.test(cmds) ||
    /\bnpm\b/.test(cmds) ||
    /\byarn\b/.test(cmds) ||
    hasFile(/^usr\/(local\/)?bin\/node$/) ||
    hasFile(/^usr\/(local\/)?bin\/npm$/)
  ) {
    runtimes.add('nodejs');
  }
  if (
    /\bpython3?\b/.test(cmds) ||
    /\bpip3?\b/.test(cmds) ||
    hasFile(/^usr\/(local\/)?bin\/python3?$/)
  ) {
    runtimes.add('python');
  }
  if (
    /\bjava\b/.test(cmds) ||
    /JAVA_HOME/.test(cmds) ||
    hasFile(/^usr\/(lib|local)\/.*\/(java|jvm)/)
  ) {
    runtimes.add('jvm');
  }
  if (/\bgolang\b|\bgo build\b|\bgo install\b/.test(cmds)) {
    runtimes.add('go');
  }
  if (/\bruby\b|\bgem install\b|\bbundler\b/.test(cmds) || hasFile(/^usr\/(local\/)?bin\/ruby$/)) {
    runtimes.add('ruby');
  }
  if (/\brustc\b|\bcargo\b/.test(cmds)) runtimes.add('rust');
  if (/\bphp\b/.test(cmds) || hasFile(/^usr\/(local\/)?bin\/php$/)) runtimes.add('php');
  if (/\bdotnet\b/.test(cmds) || hasFile(/^usr\/share\/dotnet/)) runtimes.add('dotnet');

  // If no runtime found and no shell either, assume a static binary image.
  if (runtimes.size === 0) {
    const hasShell =
      hasFile(/^bin\/(sh|bash|dash|ash)$/) || hasFile(/^usr\/bin\/(sh|bash)$/);
    if (!hasShell) runtimes.add('static');
  }

  return {
    distro,
    distroVersion,
    prettyName,
    runtimes: Array.from(runtimes),
  };
}

interface SuggestionMapEntry {
  image: string;
  estMB: number;
  alternatives: string[];
}

const DEBIAN_VERSION = 'debian12'; // bookworm-era — matches `gcr.io/distroless/*-debian12`

function debianSuggestion(runtime: Runtime): SuggestionMapEntry {
  switch (runtime) {
    case 'nodejs':
      return {
        image: `gcr.io/distroless/nodejs20-${DEBIAN_VERSION}`,
        estMB: 120,
        alternatives: ['cgr.dev/chainguard/node:latest'],
      };
    case 'python':
      return {
        image: `gcr.io/distroless/python3-${DEBIAN_VERSION}`,
        estMB: 50,
        alternatives: ['cgr.dev/chainguard/python:latest'],
      };
    case 'jvm':
      return {
        image: `gcr.io/distroless/java21-${DEBIAN_VERSION}`,
        estMB: 200,
        alternatives: ['cgr.dev/chainguard/jre:latest'],
      };
    case 'go':
    case 'rust':
    case 'static':
      return {
        image: `gcr.io/distroless/static-${DEBIAN_VERSION}`,
        estMB: 2,
        alternatives: ['cgr.dev/chainguard/static:latest'],
      };
    case 'dotnet':
      return {
        image: `gcr.io/distroless/cc-${DEBIAN_VERSION}`,
        estMB: 25,
        alternatives: ['cgr.dev/chainguard/dotnet-runtime:latest'],
      };
    default:
      return {
        image: `gcr.io/distroless/base-${DEBIAN_VERSION}`,
        estMB: 20,
        alternatives: ['cgr.dev/chainguard/glibc-dynamic:latest'],
      };
  }
}

function chainguardSuggestion(runtime: Runtime): SuggestionMapEntry {
  switch (runtime) {
    case 'nodejs':
      return { image: 'cgr.dev/chainguard/node:latest', estMB: 110, alternatives: [] };
    case 'python':
      return { image: 'cgr.dev/chainguard/python:latest', estMB: 45, alternatives: [] };
    case 'jvm':
      return { image: 'cgr.dev/chainguard/jre:latest', estMB: 180, alternatives: [] };
    case 'go':
    case 'rust':
    case 'static':
      return { image: 'cgr.dev/chainguard/static:latest', estMB: 2, alternatives: [] };
    case 'ruby':
      return { image: 'cgr.dev/chainguard/ruby:latest', estMB: 80, alternatives: [] };
    case 'php':
      return { image: 'cgr.dev/chainguard/php:latest', estMB: 70, alternatives: [] };
    case 'dotnet':
      return {
        image: 'cgr.dev/chainguard/dotnet-runtime:latest',
        estMB: 90,
        alternatives: [],
      };
    default:
      return {
        image: 'cgr.dev/chainguard/glibc-dynamic:latest',
        estMB: 20,
        alternatives: [],
      };
  }
}

export function suggestDistroless(info: BaseImageInfo): DistrolessSuggestion {
  const primaryRuntime: Runtime = info.runtimes[0] ?? 'static';

  // Alpine → Chainguard (Wolfi-flavored). Debian/Ubuntu → distroless first.
  if (info.distro === 'alpine') {
    const cg = chainguardSuggestion(primaryRuntime);
    return {
      image: cg.image,
      reason: `Alpine + ${primaryRuntime} detected — Chainguard images replace musl-based runtimes and ship with SBOMs.`,
      estimatedSizeMB: cg.estMB,
      alternatives: cg.alternatives,
    };
  }

  if (info.distro === 'debian' || info.distro === 'ubuntu' || info.distro === 'unknown') {
    const deb = debianSuggestion(primaryRuntime);
    const distroLabel =
      info.distro === 'unknown' ? 'glibc-based image' : `${info.distro}${info.distroVersion ? ' ' + info.distroVersion : ''}`;
    return {
      image: deb.image,
      reason: `${distroLabel} + ${primaryRuntime} detected — distroless ships only the runtime + libc, no shell or package manager.`,
      estimatedSizeMB: deb.estMB,
      alternatives: deb.alternatives,
    };
  }

  // rocky / fedora / centos → recommend Chainguard
  const cg = chainguardSuggestion(primaryRuntime);
  return {
    image: cg.image,
    reason: `${info.distro} + ${primaryRuntime} detected — consider a Chainguard image for a smaller, SBOM-attested base.`,
    estimatedSizeMB: cg.estMB,
    alternatives: cg.alternatives,
  };
}
