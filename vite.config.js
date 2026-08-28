import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { viteSingleFile } from "vite-plugin-singlefile";

export default defineConfig({
  base: "./",
  plugins: [
    react(),
    // JS/CSSをindex.htmlに全て埋め込む（スマホだけで公開できるようにするため）
    viteSingleFile({ removeViteModuleLoader: true }),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "inline",
      includeAssets: ["icon-192.png", "icon-512.png"],
      manifest: {
        name: "スコアブック（試作）",
        short_name: "スコア",
        description: "少年野球スコアブック 記録アプリ 試作版",
        theme_color: "#15273D",
        background_color: "#E9ECF0",
        display: "standalone",
        orientation: "portrait",
        start_url: "./",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" }
        ]
      },
      workbox: { globPatterns: ["**/*.{html,png,webmanifest}"] }
    })
  ]
});
