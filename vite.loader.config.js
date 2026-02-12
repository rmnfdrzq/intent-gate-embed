const path = require("path");
const { defineConfig } = require("vite");

module.exports = defineConfig({
  build: {
    rollupOptions: {
      input: path.resolve(__dirname, "src/loader.js"),
      output: {
        format: "iife",
        entryFileNames: "loader.js",
      },
    },
    minify: true,
    target: "es2018",
    outDir: "dist",
    emptyOutDir: false,
  },
});
