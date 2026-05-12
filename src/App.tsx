import { useCallback, useMemo, useState } from 'react';
import { RotateCcw, Layers } from 'lucide-react';
import type { ParseProgress, ParsedImage } from '@/types/image';
import { parseDockerImage } from '@/lib/image-parse';
import { Upload } from '@/components/Upload';
import { LayerList } from '@/components/LayerList';
import { FileTree } from '@/components/FileTree';
import { Inspector } from '@/components/Inspector';
import { ThemeToggle } from '@/components/ThemeToggle';
import { formatBytes } from '@/lib/utils';

export default function App() {
  const [image, setImage] = useState<ParsedImage | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<ParseProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedLayer, setSelectedLayer] = useState(0);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  const onFile = useCallback(async (file: File) => {
    setLoading(true);
    setError(null);
    setProgress({ phase: 'reading-manifest', message: 'Opening tarball…' });
    try {
      const parsed = await parseDockerImage(file, (p) => setProgress(p));
      setImage(parsed);
      setSelectedLayer(parsed.layers.length - 1);
      setSelectedPath(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      console.error(err);
    } finally {
      setLoading(false);
      setProgress(null);
    }
  }, []);

  const reset = () => {
    setImage(null);
    setSelectedLayer(0);
    setSelectedPath(null);
    setError(null);
  };

  const maxLayerSize = useMemo(
    () => (image ? Math.max(...image.layers.map((l) => l.size), 1) : 1),
    [image],
  );

  if (!image) {
    return (
      <div className="h-screen w-screen bg-canvas text-text-primary">
        <div className="absolute top-2 right-2 z-10">
          <ThemeToggle />
        </div>
        <Upload onFile={onFile} loading={loading} progress={progress} error={error} />
      </div>
    );
  }

  return (
    <div className="h-screen w-screen flex flex-col bg-canvas text-text-primary">
      <header className="flex items-center justify-between px-3 py-2 bg-surface border-b border-divider shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <Layers size={16} className="text-accent shrink-0" />
          <span className="font-bold text-accent">image-explorer</span>
          <span className="text-text-muted text-xs hidden sm:inline">— web dive</span>
          {image.stats.repoTags.length > 0 && (
            <span className="ml-3 text-xs font-mono text-text-secondary truncate">
              {image.stats.repoTags[0]}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <div className="text-xs text-text-secondary hidden md:flex items-center gap-3">
            <span>
              <span className="text-text-muted">size </span>
              <span className="font-mono text-text-primary">
                {formatBytes(image.stats.totalSize)}
              </span>
            </span>
            <span>
              <span className="text-text-muted">layers </span>
              <span className="font-mono text-text-primary">{image.stats.layerCount}</span>
            </span>
            <span>
              <span className="text-text-muted">bloat </span>
              <span className="font-mono text-warn">
                {formatBytes(image.stats.potentialSavings)}
              </span>
            </span>
          </div>
          <button
            onClick={reset}
            className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs text-text-secondary hover:text-accent hover:bg-surface-2 transition-colors"
            title="Load another image"
          >
            <RotateCcw size={14} /> New image
          </button>
          <ThemeToggle />
        </div>
      </header>

      <div
        className="flex-1 grid min-h-0"
        style={{ gridTemplateColumns: 'minmax(280px, 22%) minmax(320px, 1fr) minmax(320px, 28%)' }}
      >
        <LayerList
          layers={image.layers}
          maxLayerSize={maxLayerSize}
          selectedIndex={selectedLayer}
          onSelect={(idx) => {
            setSelectedLayer(idx);
            setSelectedPath(null);
          }}
        />
        {image.layers[selectedLayer] && (
          <FileTree
            layer={image.layers[selectedLayer]!}
            selectedPath={selectedPath}
            onSelect={setSelectedPath}
          />
        )}
        <Inspector
          image={image}
          selectedLayer={selectedLayer}
          selectedPath={selectedPath}
        />
      </div>
    </div>
  );
}
