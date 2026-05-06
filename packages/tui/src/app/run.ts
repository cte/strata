import { ensureRuntimeDirs, getCortexPaths } from "@cortex/core";
import { TuiRuntime } from "../runtime.js";
import { ProcessTerminal } from "../terminal.js";
import { buildAppOptions, CortexApp, shutdownOnExit } from "./app.js";

export interface RunTuiOptions {
  repoRoot?: string;
}

export async function runTui(options: RunTuiOptions = {}): Promise<void> {
  const paths = getCortexPaths(options.repoRoot);
  const repoRoot = paths.repoRoot;
  await ensureRuntimeDirs(paths);
  const { options: appOptions, authStatus } = await buildAppOptions(repoRoot);
  const terminal = new ProcessTerminal();
  let fatal: unknown;
  const runtime = new TuiRuntime({
    terminal,
    root: { render: () => ({ lines: [] }) },
    onFatalError: (error) => {
      fatal = error;
    },
  });
  const app = new CortexApp(runtime, appOptions, authStatus);
  runtime.setRoot(app);
  shutdownOnExit(runtime);
  runtime.start();
  await new Promise<void>((resolve) => {
    const interval = setInterval(() => {
      if (!app.running || fatal !== undefined) {
        clearInterval(interval);
        resolve();
      }
    }, 50);
  });
  if (fatal !== undefined) {
    throw fatal instanceof Error ? fatal : new Error(String(fatal));
  }
}
