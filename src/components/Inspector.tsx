import type { ParsedImage } from '@/types/image';
import { formatBytes, formatMode, findFile } from '@/lib/utils';
import { BloatSummary } from './BloatSummary';
import { DistrolessSuggestion } from './DistrolessSuggestion';

interface Props {
  image: ParsedImage;
  selectedLayer: number;
  selectedPath: string | null;
}

export function Inspector({ image, selectedLayer, selectedPath }: Props) {
  const file = selectedPath ? findFile(image.files, selectedPath) : undefined;
  const layer = image.layers[selectedLayer];

  return (
    <div className="h-full flex flex-col bg-surface border-l border-divider min-w-0">
      <div className="px-3 py-2 border-b border-divider text-xs uppercase tracking-wide text-text-secondary">
        Inspector
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-4 text-sm">
        {/* Aggregate stats */}
        <div className="border border-card-border bg-card-bg rounded-md p-3 glow-card">
          <div className="text-xs uppercase tracking-wide text-text-secondary mb-2">
            Image stats
          </div>
          <Row label="Total size" value={formatBytes(image.stats.totalSize)} />
          <Row label="Layers" value={`${image.stats.layerCount}`} />
          <Row label="Files" value={`${image.stats.fileCount}`} />
          <Row
            label="Potential savings"
            value={formatBytes(image.stats.potentialSavings)}
            highlight={image.stats.potentialSavings > 0 ? 'warn' : undefined}
          />
          {image.stats.repoTags.length > 0 && (
            <div className="mt-2 pt-2 border-t border-divider">
              <div className="text-xs text-text-muted mb-1">Tags</div>
              {image.stats.repoTags.map((t) => (
                <div key={t} className="font-mono text-xs text-accent break-all">
                  {t}
                </div>
              ))}
            </div>
          )}
        </div>

        <DistrolessSuggestion baseImage={image.baseImage} suggestion={image.suggestion} />

        <BloatSummary entries={image.bloat} layers={image.layers} />

        {/* Selected file */}
        <div className="border border-card-border bg-card-bg rounded-md p-3">
          <div className="text-xs uppercase tracking-wide text-text-secondary mb-2">
            Selected file
          </div>
          {!file && (
            <div className="text-text-muted text-sm">
              {selectedPath
                ? `(${selectedPath} — directory or layer-local entry)`
                : 'Click a file in the tree to inspect.'}
            </div>
          )}
          {file && (
            <div className="space-y-1.5">
              <div className="font-mono text-xs break-all text-text-primary">
                /{file.path}
              </div>
              <Row label="Size" value={formatBytes(file.size)} />
              <Row label="Mode" value={formatMode(file.mode)} mono />
              <Row label="Type" value={file.isDir ? 'directory' : file.isSymlink ? 'symlink' : 'file'} />
              {file.linkname && <Row label="→ links to" value={file.linkname} mono />}
              <Row label="Added in" value={`Layer ${file.addedInLayer}`} />
              <Row label="Last modified in" value={`Layer ${file.lastModifiedInLayer}`} />
              {file.removedInLayer !== undefined && (
                <Row
                  label="Removed in"
                  value={`Layer ${file.removedInLayer}`}
                  highlight="bad"
                />
              )}
            </div>
          )}
        </div>

        {/* Selected layer history command */}
        {layer && (
          <div className="border border-card-border bg-card-bg rounded-md p-3">
            <div className="text-xs uppercase tracking-wide text-text-secondary mb-2">
              Layer {layer.index} command
            </div>
            <pre className="text-xs font-mono whitespace-pre-wrap break-words text-accent">
{layer.command || '(empty / base layer)'}
            </pre>
            <div className="mt-2 text-xs text-text-muted">
              {layer.history?.created && `Created: ${layer.history.created}`}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  mono,
  highlight,
}: {
  label: string;
  value: string;
  mono?: boolean;
  highlight?: 'warn' | 'bad';
}) {
  const color =
    highlight === 'bad' ? 'text-removed' : highlight === 'warn' ? 'text-warn' : 'text-text-primary';
  return (
    <div className="flex items-baseline justify-between gap-3 text-xs">
      <span className="text-text-secondary shrink-0">{label}</span>
      <span className={`${color} ${mono ? 'font-mono' : ''} text-right`}>{value}</span>
    </div>
  );
}
