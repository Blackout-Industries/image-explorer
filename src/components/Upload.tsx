import { useCallback, useRef, useState } from 'react';
import {
  Upload as UploadIcon,
  FileArchive,
  Terminal,
  Cloud,
  Loader2,
} from 'lucide-react';
import type { ParseProgress } from '@/types/image';

interface Props {
  /** Drop / pick a local .tar. */
  onFile: (file: File) => void;
  /** Pull from a registry via the local proxy. */
  onPullRef: (ref: string, platform: 'amd64' | 'arm64') => void;
  loading: boolean;
  progress: ParseProgress | null;
  error: string | null;
}

const DEFAULT_PROXY = 'http://localhost:5099';

export function Upload({ onFile, onPullRef, loading, progress, error }: Props) {
  const [dragOver, setDragOver] = useState(false);
  const [imageRef, setImageRef] = useState('');
  const [platform, setPlatform] = useState<'amd64' | 'arm64'>('amd64');
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(
    (files: FileList | null) => {
      if (!files || files.length === 0) return;
      const first = files[0];
      if (first) onFile(first);
    },
    [onFile],
  );

  const submitRef = useCallback(() => {
    const trimmed = imageRef.trim();
    if (!trimmed || loading) return;
    onPullRef(trimmed, platform);
  }, [imageRef, platform, loading, onPullRef]);

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
          Drop a <code className="text-accent">docker save</code> tarball here — or pull one by ref. Everything runs in your browser; the optional proxy only forwards registry blobs.
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
          {loading ? 'Working…' : 'Pick a .tar file'}
        </button>

        {/* ── Pull-by-ref ── */}
        <div className="mt-8 text-left bg-canvas border border-divider rounded-md p-4">
          <div className="flex items-center gap-2 text-text-secondary mb-3 text-sm">
            <Cloud size={14} />
            <span>Or pull by image ref (via local proxy on {DEFAULT_PROXY})</span>
          </div>
          <div className="flex flex-wrap gap-2">
            <input
              type="text"
              value={imageRef}
              onChange={(e) => setImageRef(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitRef();
              }}
              placeholder="nginx:1.27  •  ghcr.io/owner/repo:tag  •  quay.io/owner/repo:tag"
              disabled={loading}
              className="flex-1 min-w-0 px-3 py-2 rounded-md bg-input-bg border border-input-border text-input-text text-sm font-mono focus:outline-none focus:border-accent disabled:opacity-50"
            />
            <select
              value={platform}
              onChange={(e) => setPlatform(e.target.value as 'amd64' | 'arm64')}
              disabled={loading}
              className="px-2 py-2 rounded-md bg-input-bg border border-input-border text-input-text text-sm font-mono focus:outline-none focus:border-accent disabled:opacity-50"
              title="Platform architecture"
            >
              <option value="amd64">amd64</option>
              <option value="arm64">arm64</option>
            </select>
            <button
              onClick={submitRef}
              disabled={loading || !imageRef.trim()}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-surface-2 hover:bg-card-bg border border-accent-dim text-accent font-semibold text-sm transition-colors disabled:opacity-50"
            >
              {loading ? <Loader2 size={16} className="animate-spin" /> : <Cloud size={16} />}
              Fetch
            </button>
          </div>
          <p className="mt-2 text-xs text-text-muted">
            Needs <code className="text-accent">docker compose up image-pull-proxy</code> running locally.
          </p>
        </div>

        <div className="mt-4 text-left bg-canvas border border-divider rounded-md p-4 text-sm">
          <div className="flex items-center gap-2 text-text-secondary mb-2">
            <Terminal size={14} />
            <span>How to get a tarball directly:</span>
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
          <div className="mt-6 text-sm text-removed border border-removed/40 rounded-md p-3 bg-removed/5 text-left">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
