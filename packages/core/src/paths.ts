import { existsSync } from "node:fs";
import path from "node:path";
import type { CortexPaths } from "./types.js";

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
      throw new Error(`Could not find Cortex repo root from ${start}`);
    }
    current = parent;
  }
}

export function getCortexPaths(repoRoot = findRepoRoot()): CortexPaths {
  const runtimeDir = path.join(repoRoot, ".cortex");
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
