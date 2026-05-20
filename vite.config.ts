import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// Build version (timestamp-based, regenerated each build)
const APP_VERSION = new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 12);

// Plugin: emit /version.json (with icon hashes), inject build hash into /sw.js,
// and cache-bust manifest icons + favicon links via ?v=<hash>
const emitVersionJson = () => {
  return {
    name: "emit-version-and-sw",
    async writeBundle(options: { dir?: string }) {
      const fs = await import("node:fs/promises");
      const p = await import("node:path");
      const crypto = await import("node:crypto");
      const outDir = options.dir || "dist";

      const iconFiles: Record<string, string> = {
        favicon: "favicon.png",
        pwa192: "pwa-192x192.png",
        pwa512: "pwa-512x512.png",
        appleTouch: "apple-touch-icon.png",
      };
      const iconHashes: Record<string, string> = {};
      for (const [k, name] of Object.entries(iconFiles)) {
        try {
          const buf = await fs.readFile(p.resolve(outDir, name));
          iconHashes[k] = crypto.createHash("sha256").update(buf).digest("hex").slice(0, 12);
        } catch {
          iconHashes[k] = "missing";
        }
      }

      // version.json with asset hashes
      try {
        await fs.writeFile(
          p.resolve(outDir, "version.json"),
          JSON.stringify({
            version: APP_VERSION,
            builtAt: new Date().toISOString(),
            assets: iconHashes,
          }),
          "utf-8",
        );
      } catch {
        // ignore
      }

      // Inject build hash into sw.js
      try {
        const swPath = p.resolve(outDir, "sw.js");
        const raw = await fs.readFile(swPath, "utf-8");
        await fs.writeFile(swPath, raw.replaceAll("__BUILD_HASH__", APP_VERSION), "utf-8");
      } catch {
        // ignore
      }

      // Rewrite manifest.webmanifest icons with ?v=<hash>
      try {
        const manifestPath = p.resolve(outDir, "manifest.webmanifest");
        const raw = await fs.readFile(manifestPath, "utf-8");
        const manifest = JSON.parse(raw);
        const hashFor = (src: string) => {
          if (src.includes("192")) return iconHashes.pwa192;
          if (src.includes("512")) return iconHashes.pwa512;
          if (src.includes("apple")) return iconHashes.appleTouch;
          if (src.includes("favicon")) return iconHashes.favicon;
          return APP_VERSION;
        };
        if (Array.isArray(manifest.icons)) {
          manifest.icons = manifest.icons.map((ic: { src: string }) => ({
            ...ic,
            src: `${ic.src.split("?")[0]}?v=${hashFor(ic.src)}`,
          }));
        }
        await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");
      } catch {
        // ignore
      }

      // Rewrite index.html icon links with ?v=<hash>
      try {
        const htmlPath = p.resolve(outDir, "index.html");
        let html = await fs.readFile(htmlPath, "utf-8");
        const subs: Array<[RegExp, string]> = [
          [/href="\/favicon\.png[^"]*"/g, `href="/favicon.png?v=${iconHashes.favicon}"`],
          [/href="\/pwa-192x192\.png[^"]*"/g, `href="/pwa-192x192.png?v=${iconHashes.pwa192}"`],
          [/href="\/pwa-512x512\.png[^"]*"/g, `href="/pwa-512x512.png?v=${iconHashes.pwa512}"`],
          [/href="\/apple-touch-icon\.png[^"]*"/g, `href="/apple-touch-icon.png?v=${iconHashes.appleTouch}"`],
        ];
        for (const [re, rep] of subs) html = html.replace(re, rep);
        await fs.writeFile(htmlPath, html, "utf-8");
      } catch {
        // ignore
      }
    },
  };
};

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
