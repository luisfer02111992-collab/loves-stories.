import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    // ExcelJS se descarga solo al exportar y su chunk aislado puede superar 500 kB.
    chunkSizeWarningLimit: 1000,
  },
});
