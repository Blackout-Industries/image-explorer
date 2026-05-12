// Apply a single layer's tar entries to a virtual filesystem state, handling
// whiteouts per the OCI / AUFS-style spec used by Docker save tarballs:
//
//   .wh.<name>         — delete <name> from the layer-below state
//   .wh..wh..opq       — opaque directory marker: clear the *entire* directory
//                        contents from layers below (children only).
//
// We track per-layer deltas so the UI can show added/modified/removed files
// per layer.

import type { LayerChange, VirtualFile } from '@/types/image';

export type FsState = Map<string, VirtualFile>;

interface LayerTarEntry {
  header: {
    name: string;
    size?: number;
    type?: string;
    mode?: number;
    linkname?: string;
  };
  /** Concatenated byte length of the entry (we don't keep contents). */
  size: number;
}

function normalizePath(p: string): string {
  // Drop leading "./" and any leading "/"; keep relative.
  return p.replace(/^\.\//, '').replace(/^\/+/, '');
}

function dirname(p: string): string {
  const idx = p.lastIndexOf('/');
  return idx < 0 ? '' : p.slice(0, idx);
}

function basename(p: string): string {
  const idx = p.lastIndexOf('/');
  return idx < 0 ? p : p.slice(idx + 1);
}

function isDirEntry(type?: string): boolean {
  return type === 'directory' || type === '5';
}

function isSymlinkEntry(type?: string): boolean {
  return type === 'symlink' || type === '2';
}

/**
 * Apply one layer's tar entries to the in-memory filesystem state.
 * Mutates `fs` and returns the per-layer delta.
 */
export function applyLayer(
  layerIndex: number,
  entries: LayerTarEntry[],
  fs: FsState,
): LayerChange[] {
  const changes: LayerChange[] = [];

  for (const entry of entries) {
    const rawName = normalizePath(entry.header.name);
    if (!rawName) continue;

    const base = basename(rawName);
    const dir = dirname(rawName);

    // ── Opaque whiteout: clear everything below this directory ──
    if (base === '.wh..wh..opq') {
      const prefix = dir ? dir + '/' : '';
      for (const [path, file] of fs) {
        if (path.startsWith(prefix) && path !== dir && !file.removedInLayer) {
          file.removedInLayer = layerIndex;
          changes.push({
            path,
            kind: 'removed',
            size: file.size,
            mode: file.mode,
            isDir: file.isDir,
          });
        }
      }
      continue;
    }

    // ── Regular whiteout: delete the named sibling ──
    if (base.startsWith('.wh.')) {
      const target = base.slice(4); // strip ".wh."
      const targetPath = dir ? dir + '/' + target : target;

      // Remove the file itself …
      const existing = fs.get(targetPath);
      if (existing && !existing.removedInLayer) {
        existing.removedInLayer = layerIndex;
        changes.push({
          path: targetPath,
          kind: 'removed',
          size: existing.size,
          mode: existing.mode,
          isDir: existing.isDir,
        });
      } else if (!existing) {
        // Record a removal even if we hadn't seen the file (rare but possible
        // with strange base images).
        changes.push({
          path: targetPath,
          kind: 'removed',
          size: 0,
          mode: 0,
          isDir: false,
        });
      }

      // … and remove any descendants if it was a directory.
      const prefix = targetPath + '/';
      for (const [path, file] of fs) {
        if (path.startsWith(prefix) && !file.removedInLayer) {
          file.removedInLayer = layerIndex;
          changes.push({
            path,
            kind: 'removed',
            size: file.size,
            mode: file.mode,
            isDir: file.isDir,
          });
        }
      }
      continue;
    }

    // ── Regular file / dir / symlink — add or modify ──
    const isDir = isDirEntry(entry.header.type);
    const isSymlink = isSymlinkEntry(entry.header.type);
    const existing = fs.get(rawName);

    if (existing && !existing.removedInLayer) {
      // Modified
      existing.size = entry.size;
      existing.mode = entry.header.mode ?? existing.mode;
      existing.lastModifiedInLayer = layerIndex;
      existing.isSymlink = isSymlink;
      existing.linkname = entry.header.linkname;
      existing.isDir = isDir;
      changes.push({
        path: rawName,
        kind: 'modified',
        size: entry.size,
        mode: existing.mode,
        isDir,
      });
    } else {
      // Added (or re-added after removal — treat as new)
      const file: VirtualFile = {
        path: rawName,
        size: entry.size,
        mode: entry.header.mode ?? 0o644,
        addedInLayer: layerIndex,
        lastModifiedInLayer: layerIndex,
        isSymlink,
        linkname: entry.header.linkname,
        isDir,
      };
      fs.set(rawName, file);
      changes.push({
        path: rawName,
        kind: 'added',
        size: entry.size,
        mode: file.mode,
        isDir,
      });
    }
  }

  return changes;
}

/** Materialize the FsState into a sorted array. */
export function finalizeFilesystem(fs: FsState): VirtualFile[] {
  return Array.from(fs.values()).sort((a, b) => a.path.localeCompare(b.path));
}
