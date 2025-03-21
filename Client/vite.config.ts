import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    proxy: {
      // Proxy API requests to bypass CORS
      '/api/proxy': {
        target: 'https://www.bitstamp.net',
        changeOrigin: true,
        rewrite: (path) => {
          // Extract the URL parameter from the request
          const url = new URL(path, 'http://localhost');
          const targetUrl = url.searchParams.get('url') || '';

          // Extract path from the full URL
          const parsedUrl = new URL(targetUrl);
          return parsedUrl.pathname + parsedUrl.search;
        },
        configure: (proxy, _options) => {
          proxy.on('error', (err, _req, _res) => {
            console.log('Proxy error:', err);
          });
          proxy.on('proxyReq', (proxyReq, req, _res) => {
            console.log('Proxy request:', req.url);
          });
          proxy.on('proxyRes', (proxyRes, req, _res) => {
            console.log('Proxy response:', proxyRes.statusCode, req.url);
          });
        },
      },
    },
  },
})
