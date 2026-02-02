/**
 * Build script for Intent Gate embed
 * 
 * Produces a single minified file with:
 * - ES2018 compatibility
 * - < 15KB gzipped
 * - No source maps
 */

const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const isWatch = process.argv.includes('--watch');

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
