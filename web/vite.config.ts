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
      },
    },
  },
});
