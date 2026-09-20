import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    // Installable on phones with a home-screen icon and standalone window.
    // Audio itself is not cached (the library is 29 GB); the shell is.
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.svg", "favicon.svg", "apple-touch-icon.png"],
      manifest: {
        name: "JYMusic",
        short_name: "JYMusic",
        description: "Your music, your server.",
        theme_color: "#0d0909",
        background_color: "#0d0909",
        display: "standalone",
        orientation: "portrait",
        start_url: "/",
        id: "/",
        icons: [
          { src: "/pwa-192.png", sizes: "192x192", type: "image/png" },
          { src: "/pwa-512.png", sizes: "512x512", type: "image/png" },
          { src: "/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
          { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
        ],
      },
      workbox: {
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          { urlPattern: /\/api\/music\/art\//, handler: "CacheFirst", options: { cacheName: "album-art", expiration: { maxEntries: 2000, maxAgeSeconds: 60 * 60 * 24 * 90 } } },
        ],
      },
    }),
  ],
  server: { port: 5174 },
  build: { sourcemap: false },
});
