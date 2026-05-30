import os from "node:os";
import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const vmHost = os.hostname();
const allowedHosts = [
  "127.0.0.1",
  "localhost",
  `${vmHost}.exe.xyz`,
  process.env.STRATA_WEB_PUBLIC_HOST,
  process.env.STRATA_WEB_CUSTOM_DOMAIN,
].flatMap((host) => (host ? [host] : []));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  server: {
    allowedHosts,
    host: process.env.STRATA_WEB_HOST ?? "127.0.0.1",
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:4174",
        ws: true,
      },
    },
  },
});
