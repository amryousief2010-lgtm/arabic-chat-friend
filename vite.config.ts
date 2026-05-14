import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// Build version (timestamp-based, regenerated each build)
const APP_VERSION = new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 12);

// Plugin to emit /version.json into the build output
const emitVersionJson = () => ({
  name: "emit-version-json",
  generateBundle() {
    // @ts-expect-error rollup context
    this.emitFile({
      type: "asset",
      fileName: "version.json",
      source: JSON.stringify({ version: APP_VERSION, builtAt: new Date().toISOString() }),
    });
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
