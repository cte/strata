import { existsSync } from "node:fs";
import path from "node:path";
import type { StrataPaths } from "./types.js";

const RUNTIME_DIR = ".strata";
const LEGACY_RUNTIME_DIR = ".cortex";

function hasRepoMarkers(dir: string): boolean {
  return existsSync(path.join(dir, "package.json")) && existsSync(path.join(dir, "CLAUDE.md"));
}

export function findRepoRoot(start = process.cwd()): string {
  let current = path.resolve(start);

  while (true) {
    if (hasRepoMarkers(current)) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      throw new Error(`Could not find Strata repo root from ${start}`);
    }
    current = parent;
  }
}

export function getStrataPaths(repoRoot = findRepoRoot()): StrataPaths {
  const currentRuntimeDir = path.join(repoRoot, RUNTIME_DIR);
  const legacyRuntimeDir = path.join(repoRoot, LEGACY_RUNTIME_DIR);
  const runtimeDir =
    existsSync(currentRuntimeDir) || !existsSync(legacyRuntimeDir)
      ? currentRuntimeDir
      : legacyRuntimeDir;
  const traceDir = path.join(runtimeDir, "traces");
  const reportsDir = path.join(runtimeDir, "reports");

  return {
    repoRoot,
    runtimeDir,
    traceDir,
    reportsDir,
    reflectionsDir: path.join(reportsDir, "reflections"),
    curatorReportsDir: path.join(reportsDir, "curator"),
    memoryDir: path.join(runtimeDir, "memory"),
    skillsDir: path.join(runtimeDir, "skills"),
    proposalsDir: path.join(runtimeDir, "proposals"),
    stateDbPath: path.join(runtimeDir, "state.sqlite"),
  };
}
