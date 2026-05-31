/// <reference types="vitest/config" />
import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The Cloudflare plugin runs the Worker (and its Durable Objects / WebSockets)
// inside workerd alongside Vite, so `pnpm dev` serves the SPA *and* the
// presence/agent backend together with HMR. It reads wrangler.jsonc as the
// source of truth and, on `vite build`, emits a deploy-ready wrangler.json.
// Skip it under Vitest, which runs the component tests in jsdom (not workerd).
const plugins = [react()];
if (!process.env.VITEST) plugins.push(cloudflare());

export default defineConfig({
  plugins,
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    css: true,
  },
});
