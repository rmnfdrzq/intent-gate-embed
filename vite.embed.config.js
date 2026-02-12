const path = require("path");
const { defineConfig, loadEnv } = require("vite");

const env = loadEnv("production", process.cwd(), "");

module.exports = defineConfig({
  build: {
    rollupOptions: {
      input: path.resolve(__dirname, "src/gate-embed.js"),
      output: {
        format: "iife",
        entryFileNames: "embed.[hash].js",
      },
    },
    minify: true,
    target: "es2018",
    outDir: "dist",
    emptyOutDir: true,
  },
  define: {
    __API_BASE__: JSON.stringify(env.API_BASE || "http://localhost:3000"),
    __GATE_UI_BASE__: JSON.stringify(env.GATE_UI_BASE || "http://localhost:5173"),
    __GATE_UI_ORIGIN__: JSON.stringify(env.GATE_UI_ORIGIN || "http://localhost:5173"),
    __HANDSHAKE_TIMEOUT_MS__: String(parseInt(env.HANDSHAKE_TIMEOUT_MS, 10) || 5000),
    __MUTATION_OBSERVER_TIMEOUT_MS__: String(
      parseInt(env.MUTATION_OBSERVER_TIMEOUT_MS, 10) || 8000
    ),
    __DEBOUNCE_MS__: String(parseInt(env.DEBOUNCE_MS, 10) || 250),
    __SCORE_THRESHOLD__: String(parseInt(env.SCORE_THRESHOLD, 10) || 5),
    __SCORE_GAP_REQUIRED__: String(parseInt(env.SCORE_GAP_REQUIRED, 10) || 2),
    __DEBUG__: env.DEBUG === "true" || env.DEBUG === "1" ? "true" : "false",
  },
});
