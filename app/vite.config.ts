import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { createRequire } from "node:module";
const cesium = createRequire(import.meta.url)("vite-plugin-cesium").default;

function localApiOriginGuard() {
  const install = (server: { middlewares: { use: (handler: (request: import("node:http").IncomingMessage, response: import("node:http").ServerResponse, next: (error?: unknown) => void) => void) => void } }) => {
    server.middlewares.use((request, response, next) => {
      if (!request.url?.startsWith("/api/") || !request.headers.origin) {
        next();
        return;
      }
      try {
        const origin = new URL(request.headers.origin);
        if (
          !request.headers.host ||
          origin.host !== request.headers.host ||
          !["http:", "https:"].includes(origin.protocol)
        ) {
          response.writeHead(403, { "Content-Type": "application/json" });
          response.end(JSON.stringify({ error: "Untrusted request origin" }));
          return;
        }
      } catch {
        response.writeHead(403, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: "Untrusted request origin" }));
        return;
      }
      // The local Python service accepts requests from the Vite proxy. Strip
      // the browser Origin after enforcing same-origin at this boundary so
      // Vite's fallback port does not need a second allowlist.
      delete request.headers.origin;
      next();
    });
  };

  return {
    name: "local-api-origin-guard",
    configureServer: install,
    configurePreviewServer: install,
  };
}

export default defineConfig({
  plugins: [react(), { ...cesium(), transformIndexHtml: undefined }, localApiOriginGuard()],
  build: {
    rollupOptions: { input: { landing: "index.html", navigator: "navigator.html" } },
  },
  server: { host: "127.0.0.1", proxy: { "/api": "http://127.0.0.1:8765" } },
  preview: { proxy: { "/api": "http://127.0.0.1:8765" } },
});
