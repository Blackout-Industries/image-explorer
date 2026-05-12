// Small UI helpers shared across components.

import type { LayerChange, TreeNode, VirtualFile } from '@/types/image';

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '0 B';
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let idx = -1;
  let v = n;
  do {
    v /= 1024;
    idx++;
  } while (v >= 1024 && idx < units.length - 1);
  return `${v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2)} ${units[idx]}`;
}

/** rwx-style mode rendering, ignoring the type bits (low 9 bits only). */
export function formatMode(mode: number): string {
  const bits = mode & 0o777;
  const triplet = (n: number) =>
    `${n & 4 ? 'r' : '-'}${n & 2 ? 'w' : '-'}${n & 1 ? 'x' : '-'}`;
  return `${triplet((bits >> 6) & 7)}${triplet((bits >> 3) & 7)}${triplet(bits & 7)}`;
}

/**
 * Build a file tree from a *single layer's delta*. Path components for
 * directories that aren't themselves in the delta become implicit
 * (kind=undefined) parent nodes so the tree renders correctly.
 */
export function buildLayerTree(changes: LayerChange[]): TreeNode {
  const root: TreeNode = {
    name: '/',
    path: '',
    isDir: true,
    size: 0,
    mode: 0o755,
    children: [],
  };

  for (const change of changes) {
    const parts = change.path.split('/').filter(Boolean);
    let node = root;
    let acc = '';
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (!part) continue;
      const isLeaf = i === parts.length - 1;
      acc = acc ? `${acc}/${part}` : part;
      let child = node.children.find((c) => c.name === part);
      if (!child) {
        child = {
          name: part,
          path: acc,
          isDir: isLeaf ? change.isDir : true,
          size: 0,
          mode: 0o755,
          children: [],
        };
        node.children.push(child);
      }
      if (isLeaf) {
        child.kind = change.kind;
        child.size = change.size;
        child.mode = change.mode;
        child.isDir = change.isDir;
      }
      node = child;
    }
  }

  sortTree(root);
  return root;
}

function sortTree(node: TreeNode) {
  node.children.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  for (const c of node.children) sortTree(c);
}

export function findFile(files: VirtualFile[], path: string): VirtualFile | undefined {
  return files.find((f) => f.path === path);
}
