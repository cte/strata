import os from "node:os";
import type { StorybookConfig } from "@storybook/react-vite";

// The exe.dev proxy forwards ports 3000-9999 at https://<vm>.exe.xyz:<port>/,
// so the dev server must accept that Host header and point its HMR/channel
// WebSocket back at the public port (6006) over the TLS proxy — otherwise the
// page serves over HTTP but the manager never finishes connecting.
const STORYBOOK_PORT = 6006;
const vmHost = os.hostname();
const allowedHosts = [".exe.xyz", `${vmHost}.exe.xyz`, "localhost", "127.0.0.1"];

const config: StorybookConfig = {
  stories: ["../src/**/*.stories.@(ts|tsx)"],
  addons: ["@storybook/addon-docs", "@storybook/addon-themes"],
  framework: {
    name: "@storybook/react-vite",
    options: {},
  },
  core: {
    disableTelemetry: true,
    // Storybook is intentionally not behind the web auth gate.
    allowedHosts,
  },
  viteFinal: async (viteConfig) => {
    const { mergeConfig } = await import("vite");
    return mergeConfig(viteConfig, {
      server: {
        host: "0.0.0.0",
        allowedHosts,
        // Pin the HMR client to the public proxy port so the WebSocket upgrades
        // to wss://<vm>.exe.xyz:6006 instead of guessing an internal port.
        hmr: { clientPort: STORYBOOK_PORT },
      },
    });
  },
};

export default config;
