/**
 * Post-build: find the hashed embed file in dist and write manifest.json.
 * Cloudflare Pages / loader.js use this to resolve the current embed script URL.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, "..", "dist");

const EMBED_REGEX = /^embed\.[^.]+\.js$/;

function findEmbedFile(dir, basePath = "") {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const rel = basePath ? basePath + "/" + e.name : e.name;
    if (e.isFile() && EMBED_REGEX.test(e.name)) {
      return "/" + rel;
    }
    if (e.isDirectory()) {
      const found = findEmbedFile(path.join(dir, e.name), rel);
      if (found) return found;
    }
  }
  return null;
}

if (!fs.existsSync(distDir)) {
  console.error("dist/ not found. Run vite build first.");
  process.exit(1);
}

const embedPath = findEmbedFile(distDir);
if (!embedPath) {
  console.error("No embed.[hash].js found in dist/");
  process.exit(1);
}

const manifest = {
  version: 1,
  generatedAt: new Date().toISOString(),
  embed: embedPath,
};

fs.writeFileSync(
  path.join(distDir, "manifest.json"),
  JSON.stringify(manifest, null, 2),
  "utf8"
);
console.log("Wrote dist/manifest.json with embed:", embedPath);
