import { Sparkles, Copy, Check } from 'lucide-react';
import { useState } from 'react';
import type { BaseImageInfo, DistrolessSuggestion as Suggestion } from '@/types/image';

interface Props {
  baseImage: BaseImageInfo;
  suggestion: Suggestion;
}

export function DistrolessSuggestion({ baseImage, suggestion }: Props) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(suggestion.image);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // clipboard unavailable
    }
  };

  return (
    <div className="border border-accent-dim bg-accent/5 rounded-md p-3">
      <div className="flex items-center gap-2 mb-2">
        <Sparkles size={14} className="text-accent" />
        <span className="text-xs uppercase tracking-wide text-accent">
          Distroless suggestion
        </span>
      </div>

      <div className="text-xs text-text-secondary mb-3">{suggestion.reason}</div>

      <div className="flex items-center gap-2 bg-canvas border border-card-border rounded-md p-2 mb-2">
        <code className="text-xs font-mono text-accent flex-1 break-all">
          {suggestion.image}
        </code>
        <button
          onClick={copy}
          className="shrink-0 p-1 rounded hover:bg-surface-2 text-text-secondary hover:text-accent"
          title="Copy"
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </button>
      </div>

      <div className="text-xs text-text-muted space-y-0.5">
        {suggestion.estimatedSizeMB !== undefined && (
          <div>~{suggestion.estimatedSizeMB} MB (vs current image).</div>
        )}
        {suggestion.alternatives.length > 0 && (
          <div>
            Also consider:{' '}
            {suggestion.alternatives.map((alt, i) => (
              <span key={alt}>
                {i > 0 && ', '}
                <code className="text-text-secondary">{alt}</code>
              </span>
            ))}
          </div>
        )}
        <div className="pt-1 text-text-muted">
          Detected:{' '}
          <span className="text-text-secondary">
            {baseImage.distro ?? 'unknown'}
            {baseImage.distroVersion ? ` ${baseImage.distroVersion}` : ''}
          </span>
          {baseImage.runtimes.length > 0 && (
            <>
              {' · '}
              <span className="text-text-secondary">{baseImage.runtimes.join(', ')}</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
