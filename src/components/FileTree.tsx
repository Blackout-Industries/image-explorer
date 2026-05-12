import { useState, useMemo } from 'react';
import { ChevronRight, ChevronDown, FilePlus, FileMinus, FileEdit, Folder, File } from 'lucide-react';
import type { Layer, TreeNode } from '@/types/image';
import { buildLayerTree, formatBytes } from '@/lib/utils';

interface Props {
  layer: Layer;
  selectedPath: string | null;
  onSelect: (path: string) => void;
}

function kindColor(kind?: string): string {
  if (kind === 'added') return 'text-added';
  if (kind === 'modified') return 'text-modified';
  if (kind === 'removed') return 'text-removed';
  return 'text-text-secondary';
}

function KindIcon({ kind, isDir }: { kind?: string; isDir: boolean }) {
  if (isDir) return <Folder size={14} />;
  if (kind === 'added') return <FilePlus size={14} />;
  if (kind === 'removed') return <FileMinus size={14} />;
  if (kind === 'modified') return <FileEdit size={14} />;
  return <File size={14} />;
}

function TreeRow({
  node,
  depth,
  selectedPath,
  onSelect,
  expanded,
  toggle,
}: {
  node: TreeNode;
  depth: number;
  selectedPath: string | null;
  onSelect: (path: string) => void;
  expanded: Set<string>;
  toggle: (p: string) => void;
}) {
  const isOpen = expanded.has(node.path);
  const isSelected = selectedPath === node.path;
  const indent = depth * 14;

  return (
    <>
      <div
        className={`flex items-center gap-1.5 px-2 py-0.5 cursor-pointer hover:bg-surface-2 ${
          isSelected ? 'bg-surface-2' : ''
        }`}
        style={{ paddingLeft: 8 + indent }}
        onClick={() => {
          if (node.isDir) toggle(node.path);
          onSelect(node.path);
        }}
      >
        <span className="w-3 flex items-center justify-center text-text-muted">
          {node.isDir ? (
            isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />
          ) : null}
        </span>
        <span className={`shrink-0 ${kindColor(node.kind)}`}>
          <KindIcon kind={node.kind} isDir={node.isDir} />
        </span>
        <span className={`text-xs font-mono truncate ${kindColor(node.kind)}`}>
          {node.name}
        </span>
        {!node.isDir && node.kind && (
          <span className="ml-auto text-xs text-text-muted font-mono pl-2 shrink-0">
            {formatBytes(node.size)}
          </span>
        )}
      </div>
      {node.isDir && isOpen &&
        node.children.map((child) => (
          <TreeRow
            key={child.path}
            node={child}
            depth={depth + 1}
            selectedPath={selectedPath}
            onSelect={onSelect}
            expanded={expanded}
            toggle={toggle}
          />
        ))}
    </>
  );
}

export function FileTree({ layer, selectedPath, onSelect }: Props) {
  const tree = useMemo(() => buildLayerTree(layer.changes), [layer]);
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    // Auto-expand top two levels for visibility.
    const set = new Set<string>(['']);
    for (const c of tree.children) {
      set.add(c.path);
    }
    return set;
  });

  const toggle = (p: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  };

  const counts = layer.changes.reduce(
    (acc, c) => {
      acc[c.kind] = (acc[c.kind] ?? 0) + 1;
      return acc;
    },
    { added: 0, modified: 0, removed: 0 } as Record<string, number>,
  );

  return (
    <div className="h-full flex flex-col bg-canvas min-w-0">
      <div className="px-3 py-2 border-b border-divider flex items-center justify-between text-xs">
        <span className="uppercase tracking-wide text-text-secondary">
          Layer {layer.index} changes
        </span>
        <span className="flex items-center gap-3 font-mono">
          <span className="text-added">+{counts.added}</span>
          <span className="text-modified">~{counts.modified}</span>
          <span className="text-removed">-{counts.removed}</span>
        </span>
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        {layer.changes.length === 0 ? (
          <div className="text-center text-text-muted text-sm mt-8 px-4">
            No file changes in this layer (empty / metadata-only).
          </div>
        ) : (
          tree.children.map((child) => (
            <TreeRow
              key={child.path}
              node={child}
              depth={0}
              selectedPath={selectedPath}
              onSelect={onSelect}
              expanded={expanded}
              toggle={toggle}
            />
          ))
        )}
      </div>
    </div>
  );
}
