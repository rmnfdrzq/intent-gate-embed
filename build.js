/**
 * Build script for Intent Gate embed
 *
 * Produces a single minified file with:
 * - ES2018 compatibility
 * - < 15KB gzipped
 * - No source maps
 *
 * Env vars from .env are injected at build time (see .env.example).
 */

require('dotenv').config();
const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const isWatch = process.argv.includes('--watch');

const env = process.env;

const buildOptions = {
  entryPoints: ['src/gate-embed.js'],
  outfile: 'dist/gate-embed.min.js',
  bundle: true,
  minify: true,
  sourcemap: false,
  target: 'es2018',
  format: 'iife',
  charset: 'utf8',
  legalComments: 'none',
  define: {
    __API_BASE__: JSON.stringify(env.API_BASE || 'http://localhost:3000'),
    __GATE_UI_BASE__: JSON.stringify(env.GATE_UI_BASE || 'http://localhost:5173'),
    __GATE_UI_ORIGIN__: JSON.stringify(env.GATE_UI_ORIGIN || 'http://localhost:5173'),
    __HANDSHAKE_TIMEOUT_MS__: String(parseInt(env.HANDSHAKE_TIMEOUT_MS, 10) || 5000),
    __MUTATION_OBSERVER_TIMEOUT_MS__: String(parseInt(env.MUTATION_OBSERVER_TIMEOUT_MS, 10) || 8000),
    __DEBOUNCE_MS__: String(parseInt(env.DEBOUNCE_MS, 10) || 250),
    __SCORE_THRESHOLD__: String(parseInt(env.SCORE_THRESHOLD, 10) || 5),
    __SCORE_GAP_REQUIRED__: String(parseInt(env.SCORE_GAP_REQUIRED, 10) || 2),
    __DEBUG__: env.DEBUG === 'true' || env.DEBUG === '1' ? 'true' : 'false',
  },
};

async function build() {
  // Ensure dist directory exists
  const distDir = path.join(__dirname, 'dist');
  if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
  }

  try {
    if (isWatch) {
      const ctx = await esbuild.context(buildOptions);
      await ctx.watch();
      console.log('Watching for changes...');
    } else {
      const result = await esbuild.build(buildOptions);
      
      // Calculate file sizes
      const outputPath = path.join(__dirname, 'dist', 'gate-embed.min.js');
      const outputContent = fs.readFileSync(outputPath);
      const rawSize = outputContent.length;
      const gzippedSize = zlib.gzipSync(outputContent).length;
      
      console.log('Build complete!');
      console.log(`  Raw size: ${(rawSize / 1024).toFixed(2)} KB`);
      console.log(`  Gzipped:  ${(gzippedSize / 1024).toFixed(2)} KB`);
      
      if (gzippedSize > 15 * 1024) {
        console.warn('  ⚠️  Warning: Gzipped size exceeds 15KB limit!');
      } else {
        console.log('  ✓ Under 15KB gzipped limit');
      }
    }
  } catch (error) {
    console.error('Build failed:', error);
    process.exit(1);
  }
}

build();
