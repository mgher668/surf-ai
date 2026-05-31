import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { crx } from "@crxjs/vite-plugin";
import { fileURLToPath, URL } from "node:url";
import manifest from "./src/manifest";

export default defineConfig({
  plugins: [react(), crx({ manifest })],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url))
    }
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) {
            return undefined;
          }

          if (
            id.includes("/react-markdown/") ||
            id.includes("\\react-markdown\\") ||
            id.includes("/remark-") ||
            id.includes("\\remark-") ||
            id.includes("/rehype-") ||
            id.includes("\\rehype-") ||
            id.includes("/micromark") ||
            id.includes("\\micromark") ||
            id.includes("/mdast-") ||
            id.includes("\\mdast-") ||
            id.includes("/hast-") ||
            id.includes("\\hast-") ||
            id.includes("/unified/") ||
            id.includes("\\unified\\")
          ) {
            return "vendor-markdown";
          }

          if (id.includes("/katex/") || id.includes("\\katex\\")) {
            return "vendor-katex";
          }

          if (id.includes("/react-photo-view/") || id.includes("\\react-photo-view\\")) {
            return "vendor-photo-view";
          }

          return undefined;
        }
      }
    }
  }
});
