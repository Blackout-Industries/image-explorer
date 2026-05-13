import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig({
  base: process.env.GITHUB_PAGES ? '/image-explorer/' : '/',
  define: {
    __APP_VERSION__: JSON.stringify(process.env.APP_VERSION ?? 'dev'),
    // tar-stream / readable-stream expect Node's `global` and `process` to exist.
    global: 'globalThis',
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
  },
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // Provide browser polyfills for tar-stream / readable-stream.
      // tar-stream pulls in `events-universal` → `events`, plus `readable-stream`
      // → `buffer` and `process`. All four need explicit browser stand-ins.
      buffer: 'buffer',
      events: 'events',
      process: 'process/browser',
      stream: 'readable-stream',
    },
  },
  optimizeDeps: {
    include: ['buffer', 'tar-stream', 'pako', 'events', 'readable-stream', 'process/browser', 'fzstd'],
  },
})
