import { ensureRuntimeDirs, getStrataPaths } from "@strata/core";
import { TuiRuntime } from "../runtime.js";
import { ProcessTerminal } from "../terminal.js";
import {
  buildAppOptions,
  type InitialSessionAction,
  StrataApp,
  type StrataAppOptions,
  shutdownOnExit,
} from "./app.js";

export type { InitialSessionAction } from "./app.js";

export interface RunTuiOptions {
  repoRoot?: string;
  initialSession?: InitialSessionAction;
}

export interface RunTuiResult {
  exitMessage: string;
}

export async function runTui(options: RunTuiOptions = {}): Promise<RunTuiResult> {
  const paths = getStrataPaths(options.repoRoot);
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
  const optionsForApp: StrataAppOptions = { ...appOptions };
  if (options.initialSession !== undefined) {
    optionsForApp.initialSession = options.initialSession;
  }
  const app = new StrataApp(runtime, optionsForApp, authStatus);
  runtime.setRoot(app);
  app.startInitialSession();
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
  return { exitMessage: app.exitMessage() };
}
