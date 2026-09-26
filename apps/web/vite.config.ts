import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * The public landing site (public/welcome) is plain static HTML, so it can't read Vite's env. This tells it where the API
 * lives (the same VITE_API_BASE_URL the app is built with) as /welcome/config.js: a build-time constant, never a URL
 * parameter a visitor could tamper with.
 */
function welcomeConfig(apiBase: string) {
  const body = `window.AQ_API=${JSON.stringify(apiBase)};
`;
  return {
    name: "welcome-config",
    configureServer(server: { middlewares: { use: (path: string, fn: (req: unknown, res: { setHeader: (k: string, v: string) => void; end: (b: string) => void }) => void) => void } }) {
      server.middlewares.use("/welcome/config.js", (_req, res) => {
        res.setHeader("Content-Type", "application/javascript");
        res.end(body);
      });
    },
    generateBundle(this: { emitFile: (f: { type: "asset"; fileName: string; source: string }) => void }) {
      this.emitFile({ type: "asset", fileName: "welcome/config.js", source: body });
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    welcomeConfig(loadEnv(mode, __dirname, "").VITE_API_BASE_URL ?? "/api"),
    // Installable-shell only (confirmed scope, UI/UX roadmap #11) — no
    // offline data promise anywhere in this app. `globPatterns` only ever
    // matches the built JS/CSS/HTML/icon assets under dist/, never an API
    // response — this app always requires a live connection for real data,
    // same as it does without a service worker at all. `NetworkFirst`/
    // `CacheFirst` runtime caching for `/api/*` was deliberately NOT added
    // here; that's the offline-write territory the plan explicitly ruled
    // out for an audited QMS (a nonconformance entered offline and synced
    // later raises real audit-timestamp/conflict questions nobody has
    // designed for).
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["branding/logo-mark.png"],
      manifest: {
        name: "AccuQual",
        short_name: "AccuQual",
        description: "Quality management system.",
        start_url: "/",
        display: "standalone",
        background_color: "#05070a",
        theme_color: "#05070a",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
        ],
      },
      workbox: {
        // App shell only — see the comment above. No runtime caching entries
        // for /api/* or any other network request.
        globPatterns: ["**/*.{js,css,html,png,svg,ico}"],
        // The public landing site (public/welcome) is its own static page, not part of the app shell.
        globIgnores: ["welcome/**"],
        navigateFallbackDenylist: [/^\/welcome\//],
        // This app ships as one large bundle (see the build's own chunk-size
        // warning — a manualChunks split is a separate, unrelated cleanup,
        // not part of this PR); workbox's 2 MiB default precache limit is
        // well under that, so raise it rather than silently precache nothing.
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
      },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  server: {
    // Not Vite's default (5173) on purpose — that port collides with other
    // local projects (e.g. OmniQual) on this machine. Keep this in sync with
    // the root README's "Getting started" section if you ever change it.
    port: 5183,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ""),
      },
    },
  },
}));
