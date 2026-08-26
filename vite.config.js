import { defineConfig } from "vite";

// Vite sirve el frontend. Tauri lo consume desde el devServer (puerto fijo)
// y, en build, desde dist/.
export default defineConfig({
  root: "src",
  publicDir: "../public",
  clearScreen: false,
  server: {
    port: 5181,
    strictPort: true,
    watch: { ignore: ["**/src-tauri/**"] },
  },
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    target: "esnext",
  },
});
