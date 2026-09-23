import { defineConfig } from "vite";

// Vite sirve el frontend. Tauri lo consume desde el devServer (puerto fijo)
// y, en build, desde dist/.
export default defineConfig({
  root: "src",
  publicDir: "../public",
  clearScreen: false,
  server: {
    // En algunos entornos Linux, "localhost" resuelve a ::1 y WebView/Vite
    // no puede abrir el socket IPv6. Fuerza IPv4 para que Tauri arranque.
    host: "127.0.0.1",
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
