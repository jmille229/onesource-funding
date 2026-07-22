import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The product app deploys at the root of app.os-funding.com, so base is "/".
// An inline (empty) PostCSS config stops Vite from walking up to the marketing
// site's root tailwind/postcss config — this app ships hand-written CSS.
export default defineConfig({
  plugins: [react()],
  css: { postcss: { plugins: [] } },
  server: { port: 5175 },
});
