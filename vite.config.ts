import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const projectRoot = fileURLToPath(new URL('.', import.meta.url));
const watchedEntries = new Set([
  'src',
  'public',
  'shared',
  'index.html',
  'vite.config.ts',
  'package.json',
  'tsconfig.json',
]);
export default defineConfig({
  base: './',
  plugins: [
    react(),
    {
      name: 'mori-local-security',
      transformIndexHtml(html, context) {
        const policy = `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'${context.server ? " 'unsafe-inline'" : ''}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: mori-asset:; font-src 'self'; media-src 'self' data: blob:; connect-src 'self' mori-asset: blob:${context.server ? ' ws://127.0.0.1:*' : ''}; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'`;
        return html.replace('__MORI_CSP__', policy);
      },
      configureServer(server) {
        server.middlewares.use('/__mori_ready', (_request, response) => {
          response.setHeader('Content-Type', 'text/plain');
          response.end(process.env.MORI_DEV_TOKEN ?? 'browser-demo');
        });
      },
    },
  ],
  server: {
    port: 5173,
    strictPort: true,
    watch: {
      // Neighboring projects and review artifacts must not reload Mori or lose
      // transient chat/animation state while the developer window is in use.
      ignored: (file: string) => {
        const relative = path.relative(projectRoot, file);
        return Boolean(relative && !watchedEntries.has(relative.split(path.sep)[0]));
      },
    },
  },
  // Keep local font subsets as files; the desktop CSP permits self-hosted fonts.
  build: { assetsInlineLimit: 0 },
});
