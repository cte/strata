import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_VERSION = "0.0.0";
const BUILD_METADATA_FILE = "strata.version.json";

export interface CliVersionInfo {
  version: string;
  dev: boolean;
  gitSha?: string;
  dirty?: boolean;
}

export async function readCliVersion(): Promise<CliVersionInfo> {
  const metadata = await readBuildMetadata();
  if (metadata !== undefined) {
    return metadata;
  }

  const repoRoot = await findRepoRootFromModule();
  if (repoRoot === undefined) {
    return { version: DEFAULT_VERSION, dev: false };
  }

  const version = await readPackageVersion(repoRoot);
  const gitSha = await runText(["git", "rev-parse", "--short=12", "HEAD"], repoRoot);
  if (gitSha === undefined || gitSha === "") {
    return { version, dev: false };
  }

  const status = await runText(["git", "status", "--porcelain"], repoRoot);
  const dirty = status !== undefined && status !== "";
  return {
    version,
    dev: true,
    gitSha,
    ...(dirty ? { dirty: true } : {}),
  };
}

export function formatCliVersion(info: CliVersionInfo): string {
  if (!info.dev) {
    return `strata ${info.version}`;
  }

  const devVersion = info.version.includes("-dev") ? info.version : `${info.version}-dev`;
  const buildMetadata = [info.gitSha, info.dirty ? "dirty" : undefined].filter(
    (part): part is string => part !== undefined && part !== "",
  );
  return `strata ${buildMetadata.length === 0 ? devVersion : `${devVersion}+${buildMetadata.join(".")}`}`;
}

async function readBuildMetadata(): Promise<CliVersionInfo | undefined> {
  const metadataPath = path.join(path.dirname(fileURLToPath(import.meta.url)), BUILD_METADATA_FILE);
  const text = await readTextFileOrUndefined(metadataPath);
  if (text === undefined) {
    return undefined;
  }

  const parsed = JSON.parse(text) as Record<string, unknown>;
  const version = nonEmptyString(parsed.version) ?? DEFAULT_VERSION;
  const gitSha = nonEmptyString(parsed.gitSha);
  const dirty = parsed.dirty === true;
  return {
    version,
    dev: parsed.dev === true,
    ...(gitSha === undefined ? {} : { gitSha }),
    ...(dirty ? { dirty: true } : {}),
  };
}

async function findRepoRootFromModule(): Promise<string | undefined> {
  let current = path.dirname(fileURLToPath(import.meta.url));
  while (true) {
    if (
      (await exists(path.join(current, "package.json"))) &&
      ((await exists(path.join(current, "AGENTS.md"))) ||
        (await exists(path.join(current, "CLAUDE.md"))))
    ) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return undefined;
    }
    current = parent;
  }
}

async function readPackageVersion(repoRoot: string): Promise<string> {
  const text = await readTextFileOrUndefined(path.join(repoRoot, "package.json"));
  if (text === undefined) {
    return DEFAULT_VERSION;
  }
  const parsed = JSON.parse(text) as Record<string, unknown>;
  return nonEmptyString(parsed.version) ?? DEFAULT_VERSION;
}

async function readTextFileOrUndefined(filePath: string): Promise<string | undefined> {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return undefined;
  }
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function runText(command: string[], cwd: string): Promise<string | undefined> {
  const proc = Bun.spawn(command, { cwd, stdout: "pipe", stderr: "ignore" });
  const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  if (exitCode !== 0) {
    return undefined;
  }
  return stdout.trim();
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}
