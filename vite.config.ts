import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// Build version (timestamp-based, regenerated each build)
const APP_VERSION = new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 12);

// Plugin to emit /version.json and inject the build hash into /sw.js
const emitVersionJson = () => ({
  name: "emit-version-and-sw",
  generateBundle() {
    // @ts-expect-error rollup context
    this.emitFile({
      type: "asset",
      fileName: "version.json",
      source: JSON.stringify({ version: APP_VERSION, builtAt: new Date().toISOString() }),
    });
  },
  async writeBundle(options: { dir?: string }) {
    try {
      const fs = await import("node:fs/promises");
      const p = await import("node:path");
      const outDir = options.dir || "dist";
      const swPath = p.resolve(outDir, "sw.js");
      const raw = await fs.readFile(swPath, "utf-8");
      await fs.writeFile(swPath, raw.replaceAll("__BUILD_HASH__", APP_VERSION), "utf-8");
    } catch {
      // ignore — sw.js قد لا يكون في dist في بعض الأوضاع
    }
  },
});

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
  },
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [
    react(),
    mode === "development" && componentTagger(),
    emitVersionJson(),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
