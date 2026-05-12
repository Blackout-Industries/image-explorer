import { useCallback, useRef, useState } from 'react';
import { Upload as UploadIcon, FileArchive, Terminal } from 'lucide-react';
import type { ParseProgress } from '@/types/image';

interface Props {
  onFile: (file: File) => void;
  loading: boolean;
  progress: ParseProgress | null;
  error: string | null;
}

export function Upload({ onFile, loading, progress, error }: Props) {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(
    (files: FileList | null) => {
      if (!files || files.length === 0) return;
      const first = files[0];
      if (first) onFile(first);
    },
    [onFile],
  );

  return (
    <div className="h-full w-full flex items-center justify-center p-8 bg-canvas text-text-primary">
      <div
        className={`max-w-2xl w-full border-2 border-dashed rounded-lg p-12 text-center transition-colors glow-card ${
          dragOver ? 'border-accent bg-surface-2' : 'border-card-border bg-surface'
        }`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          handleFiles(e.dataTransfer.files);
        }}
        onPaste={(e) => handleFiles(e.clipboardData.files)}
      >
        <FileArchive size={56} className="mx-auto text-accent mb-4" />
        <h1 className="text-2xl font-bold mb-2 text-text-primary">
          image-explorer
        </h1>
        <p className="text-text-secondary text-sm mb-6">
          Drop a <code className="text-accent">docker save</code> tarball here — or click to pick one. Everything runs in your browser; nothing leaves this tab.
        </p>

        <input
          ref={inputRef}
          type="file"
          accept=".tar,application/x-tar,application/octet-stream"
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
        <button
          onClick={() => inputRef.current?.click()}
          disabled={loading}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-md bg-surface-2 hover:bg-card-bg border border-accent-dim text-accent font-semibold transition-colors disabled:opacity-50"
        >
          <UploadIcon size={18} />
          {loading ? 'Parsing…' : 'Pick a .tar file'}
        </button>

        <div className="mt-8 text-left bg-canvas border border-divider rounded-md p-4 text-sm">
          <div className="flex items-center gap-2 text-text-secondary mb-2">
            <Terminal size={14} />
            <span>How to get this:</span>
          </div>
          <pre className="text-accent overflow-x-auto">
{`docker save myimage:tag -o myimage.tar`}
          </pre>
        </div>

        {progress && loading && (
          <div className="mt-6 text-sm text-text-secondary">
            <div>{progress.message}</div>
            {progress.phase === 'parsing-layer' &&
              progress.layerIndex !== undefined &&
              progress.layerCount !== undefined && (
                <div className="mt-2 h-1.5 bg-surface-2 rounded overflow-hidden">
                  <div
                    className="h-full bg-accent transition-all"
                    style={{
                      width: `${
                        ((progress.layerIndex + 1) / progress.layerCount) * 100
                      }%`,
                    }}
                  />
                </div>
              )}
          </div>
        )}

        {error && (
          <div className="mt-6 text-sm text-removed border border-removed/40 rounded-md p-3 bg-removed/5">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
