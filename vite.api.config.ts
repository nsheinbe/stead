/**
 * Serverless API bundle for Vercel.
 *
 * Vite's framework preset compiles api/*.ts without following extensionless
 * ESM imports into server/, so the deployed function crashed with
 * `Cannot find module '/var/task/server/app'`. This build inlines server/
 * (and src/ type-erased) into one ESM file; npm packages stay external for
 * Vercel's node_modules.
 */
import path from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  publicDir: false,
  build: {
    ssr: path.resolve(__dirname, "server/vercel.ts"),
    outDir: path.resolve(__dirname, "dist-api"),
    emptyOutDir: true,
    sourcemap: false,
    minify: false,
    rollupOptions: {
      output: {
        format: "es",
        entryFileNames: "handler.js",
        inlineDynamicImports: true,
      },
    },
  },
});
