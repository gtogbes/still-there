import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    /**
     * The MCP endpoint is proxied rather than called directly.
     *
     * Two reasons. API Gateway sends no CORS headers for the /mcp route, and adding
     * them would mean opening a server-to-server protocol endpoint to arbitrary
     * browsers — which is not something to do for the convenience of a demo. Proxying
     * in the dev server keeps the browser same-origin and the endpoint unchanged.
     */
    proxy: {
      '/api/mcp': {
        target: process.env['STILL_THERE_API'] ?? 'https://eop88u898f.execute-api.us-east-1.amazonaws.com',
        changeOrigin: true,
        rewrite: () => '/mcp',
        // The MCP server rejects unknown browser Origins with 403, as the spec
        // requires. Through the dev proxy the request is server-to-server, so the
        // localhost Origin is dropped rather than added to the production allow-list.
        configure: (proxy) => proxy.on('proxyReq', (req) => req.removeHeader('origin')),
      },
      // The assistant route exists on the API under the same path, so it is passed
      // through unchanged. Without this, typed and spoken questions 404 in dev.
      '/api/assistant': {
        target: process.env['STILL_THERE_API'] ?? 'https://eop88u898f.execute-api.us-east-1.amazonaws.com',
        changeOrigin: true,
      },
    },
  },
});
