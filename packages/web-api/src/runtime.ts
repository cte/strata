import { getStrataPaths } from "@strata/core";
import type { CreateChatServiceOptions } from "./chat.js";

/**
 * Shared options surface for the web-api boundary. Holds the repo root, env
 * snapshot, optional fetch override, and chat-stream tuning. Both
 * `chatServices` and `connectorServices` consume this; `createWebApiServices`
 * receives it from the host process (CLI / tests).
 */
export interface WebApiOptions extends CreateChatServiceOptions {
  fetchImpl?: typeof fetch;
  now?: Date;
  chatStreamHeartbeatMs?: number;
}

export function repoRoot(options: WebApiOptions): string {
  return getStrataPaths(options.repoRoot).repoRoot;
}

export function runtimeEnv(options: WebApiOptions): Record<string, string | undefined> {
  return options.env ?? Bun.env;
}

export function runtime(options: WebApiOptions) {
  return {
    repoRoot: repoRoot(options),
    env: runtimeEnv(options),
    ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
    ...(options.now === undefined ? {} : { now: options.now }),
  };
}
