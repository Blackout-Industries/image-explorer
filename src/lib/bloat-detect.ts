// Bloat detection — files that were added in one layer and then removed in a
// later layer. These bytes are sitting in the lower layer of the final image
// for no reason; squashing or reordering would save space.

import type { BloatEntry, VirtualFile } from '@/types/image';

export function detectBloat(files: VirtualFile[]): BloatEntry[] {
  const out: BloatEntry[] = [];
  for (const f of files) {
    if (
      f.removedInLayer !== undefined &&
      f.removedInLayer > f.addedInLayer &&
      !f.isDir
    ) {
      out.push({
        path: f.path,
        size: f.size,
        addedInLayer: f.addedInLayer,
        removedInLayer: f.removedInLayer,
      });
    }
  }
  // Largest first — most actionable.
  out.sort((a, b) => b.size - a.size);
  return out;
}
