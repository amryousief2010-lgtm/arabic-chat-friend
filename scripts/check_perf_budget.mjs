/**
 * First-load and route-chunk budget for dist/index.html.
 *
 * Gzip is level 9, matching the mobile perf report.
 * Post-P3 first load measured 288,238 bytes (under the 300 KB cap) and did not
 * modulepreload recharts, jspdf, xlsx, exceljs, or html2pdf. The largest page
 * chunk in that build was under 80 KB gzip. Those libraries stay lazy and are
 * not counted as route chunks; preloading any of them still fails the build.
 *
 *   DIST_DIR=dist node scripts/check_perf_budget.mjs
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const FIRST_LOAD_LIMIT = 300 * 1024;
const ROUTE_CHUNK_LIMIT = 80 * 1024;
const HEAVY_LIBS = ["recharts", "jspdf", "xlsx", "exceljs", "html2pdf"];

const distDir = path.resolve(process.env.DIST_DIR || "dist");
const htmlPath = path.join(distDir, "index.html");
const html = fs.readFileSync(htmlPath, "utf8");

function attr(tag, name) {
  const match = tag.match(new RegExp(`${name}="([^"]*)"`));
  return match ? match[1] : "";
}

function gzipSize(filePath) {
  const raw = fs.readFileSync(filePath);
  return zlib.gzipSync(raw, { level: 9 }).length;
}

function resolveAsset(href) {
  const rel = href.replace(/^\//, "");
  return path.join(distDir, rel);
}

function isJs(href) {
  return href.split("?")[0].endsWith(".js");
}

function isHeavy(fileName) {
  const base = fileName.toLowerCase();
  return HEAVY_LIBS.some((name) => base.includes(name));
}

const linkTags = [...html.matchAll(/<link\b[^>]*>/g)].map((match) => match[0]);
const modulepreloads = linkTags
  .filter((tag) => attr(tag, "rel") === "modulepreload")
  .map((tag) => attr(tag, "href"))
  .filter(isJs);

const entryScripts = [...html.matchAll(/<script\b[^>]*>/g)]
  .map((match) => attr(match[0], "src"))
  .filter(isJs);

const firstLoadHrefs = [...new Set([...modulepreloads, ...entryScripts])];
const firstLoadFiles = new Set(
  firstLoadHrefs.map((href) => path.basename(resolveAsset(href))),
);

const failures = [];
let firstLoadTotal = 0;

console.log("First-load JS (gzip-9):");
for (const href of firstLoadHrefs) {
  const filePath = resolveAsset(href);
  const size = gzipSize(filePath);
  firstLoadTotal += size;
  const name = path.basename(filePath);
  console.log(`  ${String(size).padStart(8)}  ${name}`);
  if (isHeavy(name)) {
    failures.push(`index.html preloads heavy library ${name}`);
  }
}
console.log(`  ${String(firstLoadTotal).padStart(8)}  TOTAL (limit ${FIRST_LOAD_LIMIT})`);
if (firstLoadTotal > FIRST_LOAD_LIMIT) {
  failures.push(
    `first-load JS is ${firstLoadTotal} bytes gzip, over ${FIRST_LOAD_LIMIT}`,
  );
}

const assetsDir = path.join(distDir, "assets");
const assetNames = fs.readdirSync(assetsDir).filter((name) => name.endsWith(".js"));
const routeChunks = [];
const lazyVendors = [];

for (const name of assetNames) {
  if (firstLoadFiles.has(name)) continue;
  const size = gzipSize(path.join(assetsDir, name));
  if (isHeavy(name)) {
    lazyVendors.push({ name, size });
    continue;
  }
  routeChunks.push({ name, size });
}

routeChunks.sort((a, b) => b.size - a.size);
lazyVendors.sort((a, b) => b.size - a.size);

console.log("\nLargest route chunks (gzip-9):");
for (const chunk of routeChunks.slice(0, 15)) {
  console.log(`  ${String(chunk.size).padStart(8)}  ${chunk.name}`);
}
for (const chunk of routeChunks) {
  if (chunk.size > ROUTE_CHUNK_LIMIT) {
    failures.push(
      `route chunk ${chunk.name} is ${chunk.size} bytes gzip, over ${ROUTE_CHUNK_LIMIT}`,
    );
  }
}

console.log("\nLazy heavy libraries (not route chunks; must not be preloaded):");
for (const chunk of lazyVendors) {
  console.log(`  ${String(chunk.size).padStart(8)}  ${chunk.name}`);
}

if (failures.length) {
  console.error("\nPerformance budget failed:");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log("\nPerformance budget passed.");
