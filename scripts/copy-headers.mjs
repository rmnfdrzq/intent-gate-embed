/**
 * Copy _headers into dist for Cloudflare Pages.
 * Ensures loader.js and manifest.json are never cached; embed.*.js is immutable.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, "..", "dist");
const src = path.join(__dirname, "..", "_headers");
const dest = path.join(distDir, "_headers");

if (!fs.existsSync(distDir)) {
  console.error("dist/ not found. Run build first.");
  process.exit(1);
}

if (!fs.existsSync(src)) {
  console.error("_headers not found in project root.");
  process.exit(1);
}

fs.copyFileSync(src, dest);
console.log("Copied _headers to dist/");
