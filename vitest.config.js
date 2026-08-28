import { defineConfig } from "vitest/config";

/* vite.config.js は PWA / singlefile プラグインを含み、テストには不要なため
   継承せず独立させる。ルールエンジンは純粋関数なので DOM も要らない。 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.spec.js"],
    reporters: ["default"],
  },
});
