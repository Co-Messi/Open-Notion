import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Response headers for `vite preview`, read from vercel.json so the production headers have a
 * single source of truth. The dev server does not use them: Vite's dev client and React Fast
 * Refresh need inline scripts, which the strict Content-Security-Policy forbids.
 */
function previewHeaders(): Record<string, string> {
  const config = JSON.parse(readFileSync(resolve(__dirname, 'vercel.json'), 'utf8')) as {
    headers?: { source: string; headers: { key: string; value: string }[] }[];
  };
  const out: Record<string, string> = {};
  for (const rule of config.headers || []) {
    if (rule.source !== '/(.*)') continue;
    for (const h of rule.headers) out[h.key] = h.value;
  }
  return out;
}

/**
 * Static hosts that cannot send headers (GitHub Pages, a plain file server) still get the policy:
 * production HTML carries it as a meta tag. Directives a meta policy cannot express
 * (frame-ancestors) are left to the real header.
 */
function cspMeta(): Plugin {
  const headers = previewHeaders();
  const csp = (headers['Content-Security-Policy'] || '')
    .split(';')
    .map(d => d.trim())
    .filter(d => d && !d.startsWith('frame-ancestors'))
    .join('; ');
  const referrer = headers['Referrer-Policy'];
  return {
    name: 'opennotion-csp-meta',
    apply: 'build',
    transformIndexHtml(html) {
      const tags = [
        csp && `<meta http-equiv="Content-Security-Policy" content="${csp}" />`,
        referrer && `<meta name="referrer" content="${referrer}" />`,
      ].filter(Boolean);
      return html.replace(/<meta charset="UTF-8" \/>/i, m => [m, ...tags].join('\n    '));
    },
  };
}

// Two pages: the landing page at / and the workspace app at /app/.
export default defineConfig({
  plugins: [react(), cspMeta()],
  server: { watch: { ignored: ['**/*.tsbuildinfo'] } },
  preview: { headers: previewHeaders() },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        app: resolve(__dirname, 'app/index.html'),
      },
    },
  },
});
