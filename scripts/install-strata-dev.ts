#!/usr/bin/env bun
import { chmod, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const binaryPath = path.join(repoRoot, "dist", "strata");
const defaultBinDir = path.join(os.homedir(), ".local", "bin");

interface InstallOptions {
  binDir: string;
  skipBuild: boolean;
}

function usage(): string {
  return `usage: bun run install:dev [--bin-dir DIR] [--skip-build]

Builds the Strata CLI/TUI development binary and installs a local launcher named
\`strata\` so it can be run from any directory.

Options:
  --bin-dir DIR   directory for the launcher (default: ~/.local/bin)
  --skip-build    install the launcher without rebuilding dist/strata
`;
}

function parseArgs(argv: string[]): InstallOptions {
  const options: InstallOptions = { binDir: defaultBinDir, skipBuild: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      console.log(usage());
      process.exit(0);
    }
    if (arg === "--bin-dir") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--bin-dir requires a directory");
      }
      options.binDir = path.resolve(expandHome(value));
      index += 1;
    } else if (arg === "--skip-build") {
      options.skipBuild = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function expandHome(value: string): string {
  if (value === "~") {
    return os.homedir();
  }
  if (value.startsWith("~/")) {
    return path.join(os.homedir(), value.slice(2));
  }
  return value;
}

async function run(command: string[], cwd: string): Promise<void> {
  const proc = Bun.spawn(command, { cwd, stdout: "inherit", stderr: "inherit" });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`${command.join(" ")} failed with exit code ${exitCode}`);
  }
}

const options = parseArgs(process.argv.slice(2));

if (!options.skipBuild) {
  await run(["bun", "run", "build:cli"], repoRoot);
}

await mkdir(options.binDir, { recursive: true });

const launcherPath = path.join(options.binDir, "strata");
const dotenvxBin = path.join(repoRoot, "node_modules", ".bin", "dotenvx");
const envPath = path.join(repoRoot, ".env");
const envKeysPath = path.join(repoRoot, ".env.keys");
const launcher = `#!/usr/bin/env bash
set -euo pipefail

STRATA_REPO_ROOT=${shellQuote(repoRoot)}
STRATA_BIN=${shellQuote(binaryPath)}
DOTENVX_BIN=${shellQuote(dotenvxBin)}
ENV_FILE=${shellQuote(envPath)}
ENV_KEYS_FILE=${shellQuote(envKeysPath)}

if [[ ! -x "$STRATA_BIN" ]]; then
  echo "strata: development binary not found at $STRATA_BIN" >&2
  echo "Run: cd $STRATA_REPO_ROOT && bun run build:cli" >&2
  exit 1
fi

exec bun "$DOTENVX_BIN" --quiet run --overload --ignore=MISSING_ENV_FILE -f "$ENV_FILE" -fk "$ENV_KEYS_FILE" -e STRATA_REPO_ROOT="$STRATA_REPO_ROOT" -- "$STRATA_BIN" "$@"
`;

await writeFile(launcherPath, launcher, "utf8");
await chmod(launcherPath, 0o755);

console.log(`installed ${launcherPath}`);
console.log("Run `strata --help` from any directory to verify the install.");
if (!isPathOnSearchPath(options.binDir)) {
  console.log(`Add ${options.binDir} to PATH if your shell cannot find \`strata\`.`);
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function isPathOnSearchPath(candidate: string): boolean {
  const normalizedCandidate = path.resolve(candidate);
  for (const entry of (process.env.PATH ?? "").split(path.delimiter)) {
    if (entry !== "" && path.resolve(expandHome(entry)) === normalizedCandidate) {
      return true;
    }
  }
  return false;
}
