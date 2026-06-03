#!/usr/bin/env bun
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entrypoint = path.join(repoRoot, "packages", "cli", "src", "index.ts");
const outputPath = path.join(repoRoot, "dist", "strata");
const metadataPath = path.join(repoRoot, "dist", "strata.version.json");

function usage(): string {
  return `usage: bun run build:cli

Builds the Strata CLI development binary, including the TUI command, to:
  dist/strata
`;
}

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(usage());
  process.exit(0);
}

await mkdir(path.dirname(outputPath), { recursive: true });
await writeBuildMetadata();

const proc = Bun.spawn(["bun", "build", entrypoint, "--target=bun", "--outfile", outputPath], {
  cwd: repoRoot,
  stdout: "inherit",
  stderr: "inherit",
});
const exitCode = await proc.exited;
if (exitCode !== 0) {
  process.exit(exitCode);
}

await chmod(outputPath, 0o755);
console.log(`built ${path.relative(repoRoot, outputPath)}`);

async function writeBuildMetadata(): Promise<void> {
  const packageJson = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8")) as {
    version?: unknown;
  };
  const version = typeof packageJson.version === "string" ? packageJson.version : "0.0.0";
  const gitSha = await runText(["git", "rev-parse", "--short=12", "HEAD"]);
  const status = await runText(["git", "status", "--porcelain"]);
  const dirty = status !== undefined && status !== "";
  await writeFile(
    metadataPath,
    `${JSON.stringify(
      {
        version,
        dev: true,
        ...(gitSha === undefined ? {} : { gitSha }),
        dirty,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

async function runText(command: string[]): Promise<string | undefined> {
  const proc = Bun.spawn(command, { cwd: repoRoot, stdout: "pipe", stderr: "ignore" });
  const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  if (exitCode !== 0) {
    return undefined;
  }
  return stdout.trim();
}
