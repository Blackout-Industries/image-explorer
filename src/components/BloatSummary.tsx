import { AlertTriangle } from 'lucide-react';
import type { BloatEntry, Layer } from '@/types/image';
import { formatBytes } from '@/lib/utils';

interface Props {
  entries: BloatEntry[];
  layers: Layer[];
}

export function BloatSummary({ entries, layers }: Props) {
  if (entries.length === 0) {
    return (
      <div className="border border-card-border bg-card-bg rounded-md p-3">
        <div className="text-xs uppercase tracking-wide text-text-secondary mb-1">
          Bloat
        </div>
        <div className="text-xs text-added">
          No add-then-delete bloat detected — nice.
        </div>
      </div>
    );
  }

  const total = entries.reduce((acc, e) => acc + e.size, 0);
  const top = entries.slice(0, 8);
  const rest = entries.length - top.length;

  return (
    <div className="border border-warn/40 bg-warn/5 rounded-md p-3">
      <div className="flex items-center gap-2 mb-2">
        <AlertTriangle size={14} className="text-warn" />
        <span className="text-xs uppercase tracking-wide text-warn">
          Bloat — {formatBytes(total)} reclaimable
        </span>
      </div>
      <div className="text-xs text-text-secondary mb-2">
        {entries.length} file{entries.length === 1 ? '' : 's'} added then deleted in a later layer.
      </div>
      <div className="space-y-1">
        {top.map((e) => (
          <div
            key={e.path}
            className="flex items-center justify-between gap-2 text-xs"
            title={`/${e.path}`}
          >
            <span className="font-mono text-text-primary truncate">/{e.path}</span>
            <span className="text-warn shrink-0 font-mono">
              {formatBytes(e.size)}{' '}
              <span className="text-text-muted">
                L{e.addedInLayer}→L{e.removedInLayer}
              </span>
            </span>
          </div>
        ))}
        {rest > 0 && (
          <div className="text-xs text-text-muted italic pt-1">
            …and {rest} more across {layers.length} layers.
          </div>
        )}
      </div>
    </div>
  );
}
