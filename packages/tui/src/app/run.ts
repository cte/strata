import process from "node:process";
import { ensureRuntimeDirs, getCortexPaths } from "@cortex/core";
import { ProcessTerminal } from "../terminal.js";
import { TuiRuntime } from "../runtime.js";
import { CortexApp, buildAppOptions, shutdownOnExit } from "./app.js";

export interface RunTuiOptions {
  repoRoot?: string;
}

export async function runTui(options: RunTuiOptions = {}): Promise<void> {
  const repoRoot = getCortexPaths(options.repoRoot).repoRoot;
  await ensureRuntimeDirs(getCortexPaths(repoRoot));
  const { options: appOptions, authStatus } = await buildAppOptions(repoRoot);
  const terminal = new ProcessTerminal();
  const runtime = new TuiRuntime({
    terminal,
    root: { render: () => ({ lines: [] }) },
    onExit: () => process.exit(0),
  });
  const app = new CortexApp(runtime, appOptions, authStatus);
  runtime.setRoot(app);
  shutdownOnExit(runtime);
  runtime.start();
  await new Promise<void>((resolve) => {
    const interval = setInterval(() => {
      if (!app.running) {
        clearInterval(interval);
        resolve();
      }
    }, 50);
  });
}
