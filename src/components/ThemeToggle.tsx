import { useEffect, useRef, useState } from 'react';
import { Palette, Check } from 'lucide-react';
import { useTheme, type Theme } from '@/hooks/useTheme';

interface Swatches {
  canvas: string;
  surface: string;
  accent: string;
  running: string;
}

const THEMES: ReadonlyArray<{ id: Theme; label: string; swatches: Swatches }> = [
  {
    id: 'mocha',
    label: 'mocha',
    swatches: { canvas: '#1e1e2e', surface: '#313244', accent: '#cba6f7', running: '#89dceb' },
  },
  {
    id: 'latte',
    label: 'latte',
    swatches: { canvas: '#eff1f5', surface: '#ccd0da', accent: '#8839ef', running: '#04a5e5' },
  },
  {
    id: 'ayu-dark',
    label: 'ayu dark',
    swatches: { canvas: '#0f1419', surface: '#14191f', accent: '#ffb454', running: '#59c2ff' },
  },
  {
    id: 'gruvbox-dark',
    label: 'gruvbox dark',
    swatches: { canvas: '#282828', surface: '#32302f', accent: '#fabd2f', running: '#83a598' },
  },
  {
    id: 'nord',
    label: 'nord',
    swatches: { canvas: '#2e3440', surface: '#3b4252', accent: '#88c0d0', running: '#81a1c1' },
  },
  {
    id: 'half-life',
    label: 'half-life',
    swatches: { canvas: '#0a0a0a', surface: '#1a1a1a', accent: '#ff6a00', running: '#ffb347' },
  },
];

function Dot({ color }: { color: string }) {
  return (
    <span
      aria-hidden
      style={{
        width: 10,
        height: 10,
        background: color,
        borderRadius: '50%',
        border: '1px solid rgba(0,0,0,0.25)',
        display: 'inline-block',
      }}
    />
  );
}

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className="p-2 rounded text-text-secondary hover:text-accent hover:bg-surface-2 transition-colors"
        title="change theme"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Palette size={16} />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-1 z-40 rounded-lg border shadow-2xl"
          style={{
            background: 'var(--theme-card-bg)',
            borderColor: 'var(--theme-card-border)',
            minWidth: 200,
          }}
        >
          <div
            className="px-3 py-2 text-[10px] uppercase tracking-wider"
            style={{
              color: 'var(--theme-text-secondary)',
              borderBottom: '1px solid var(--theme-divider)',
            }}
          >
            theme
          </div>
          <ul className="py-1">
            {THEMES.map(t => {
              const active = t.id === theme;
              return (
                <li key={t.id}>
                  <button
                    role="menuitemradio"
                    aria-checked={active}
                    onClick={() => {
                      setTheme(t.id);
                      setOpen(false);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-[12px] transition-colors"
                    style={{
                      color: 'var(--theme-text-primary)',
                      background: active
                        ? 'var(--theme-surface-2)'
                        : 'transparent',
                    }}
                    onMouseEnter={e => {
                      if (!active)
                        (e.currentTarget as HTMLButtonElement).style.background =
                          'var(--theme-surface)';
                    }}
                    onMouseLeave={e => {
                      if (!active)
                        (e.currentTarget as HTMLButtonElement).style.background =
                          'transparent';
                    }}
                  >
                    <span className="flex items-center gap-0.5 shrink-0">
                      <Dot color={t.swatches.canvas} />
                      <Dot color={t.swatches.surface} />
                      <Dot color={t.swatches.accent} />
                      <Dot color={t.swatches.running} />
                    </span>
                    <span className="flex-1 truncate">{t.label}</span>
                    <span
                      className="w-4 shrink-0 flex justify-center"
                      style={{ color: 'var(--theme-accent)' }}
                    >
                      {active ? <Check size={12} /> : null}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
