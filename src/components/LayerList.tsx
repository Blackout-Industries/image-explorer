import type { Layer } from '@/types/image';
import { formatBytes } from '@/lib/utils';

interface Props {
  layers: Layer[];
  maxLayerSize: number;
  selectedIndex: number;
  onSelect: (idx: number) => void;
}

/** Map size ratio (0..1) to a tailwind color class via inline style for nuance. */
function sizeBarColor(ratio: number): string {
  // green → yellow → red as ratio grows.
  if (ratio < 0.2) return 'var(--theme-added)';
  if (ratio < 0.5) return 'var(--theme-modified)';
  return 'var(--theme-removed)';
}

export function LayerList({ layers, maxLayerSize, selectedIndex, onSelect }: Props) {
  return (
    <div className="h-full flex flex-col bg-surface border-r border-divider min-w-0">
      <div className="px-3 py-2 border-b border-divider text-xs uppercase tracking-wide text-text-secondary">
        Layers ({layers.length})
      </div>
      <div className="flex-1 overflow-y-auto">
        {layers.map((layer) => {
          const ratio = maxLayerSize > 0 ? layer.size / maxLayerSize : 0;
          const isSelected = layer.index === selectedIndex;
          return (
            <button
              key={layer.index}
              onClick={() => onSelect(layer.index)}
              className={`w-full text-left px-3 py-2 border-b border-divider transition-colors hover:bg-surface-2 ${
                isSelected ? 'bg-surface-2' : ''
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <span
                    className={`text-xs font-mono ${
                      isSelected ? 'text-accent' : 'text-text-secondary'
                    }`}
                  >
                    L{layer.index.toString().padStart(2, '0')}
                  </span>
                  <span className="text-xs text-text-muted font-mono">
                    {layer.digest}
                  </span>
                </div>
                <span className="text-xs text-text-secondary font-mono">
                  {formatBytes(layer.size)}
                </span>
              </div>
              <div className="h-1 rounded-sm overflow-hidden bg-canvas mb-1.5">
                <div
                  className="h-full"
                  style={{
                    width: `${Math.max(2, ratio * 100)}%`,
                    background: sizeBarColor(ratio),
                  }}
                />
              </div>
              <div
                className={`text-xs font-mono truncate ${
                  isSelected ? 'text-text-primary' : 'text-text-secondary'
                }`}
                title={layer.command || '(no command — empty/base layer)'}
              >
                {layer.command || <span className="text-text-muted italic">(base layer)</span>}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
