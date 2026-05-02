import path from "node:path";

export type PathAccess = "read" | "write";

export interface ResolvedRepoPath {
  repoRoot: string;
  absolutePath: string;
  relativePath: string;
}

export interface ResolveRepoPathOptions {
  access: PathAccess;
  allowRoot?: boolean;
  allowRawRead?: boolean;
}

const BLOCKED_PATH_SEGMENTS = new Set([".git", ".cortex", "node_modules", "dist"]);

export class PolicyViolationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "PolicyViolationError";
    this.code = code;
  }
}

export function resolveRepoPath(
  repoRoot: string,
  requestedPath: string,
  options: ResolveRepoPathOptions,
): ResolvedRepoPath {
  if (requestedPath.trim() === "") {
    throw new PolicyViolationError("empty_path", "Path cannot be empty");
  }

  const root = path.resolve(repoRoot);
  const absolutePath = path.resolve(root, requestedPath);

  if (!isPathInside(root, absolutePath)) {
    throw new PolicyViolationError("outside_repo", `Path escapes the repository: ${requestedPath}`);
  }

  const relativePath = toPosixPath(path.relative(root, absolutePath));
  if (relativePath === "") {
    if (options.allowRoot === true) {
      return { repoRoot: root, absolutePath, relativePath };
    }
    throw new PolicyViolationError("root_path", "Path must point to a file or subdirectory");
  }

  rejectBlockedSegments(relativePath);

  if (options.access === "write" && isRawPath(relativePath)) {
    throw new PolicyViolationError(
      "raw_write_forbidden",
      `Writes under raw/ are forbidden: ${relativePath}`,
    );
  }

  if (options.access === "read" && isRawPath(relativePath) && options.allowRawRead !== true) {
    throw new PolicyViolationError(
      "raw_read_not_enabled",
      `Reading raw/ requires includeRaw: true: ${relativePath}`,
    );
  }

  return { repoRoot: root, absolutePath, relativePath };
}

export function assertReadAllowed(
  repoRoot: string,
  requestedPath: string,
  options: Omit<ResolveRepoPathOptions, "access"> = {},
): ResolvedRepoPath {
  return resolveRepoPath(repoRoot, requestedPath, { ...options, access: "read" });
}

export function assertWriteAllowed(repoRoot: string, requestedPath: string): ResolvedRepoPath {
  return resolveRepoPath(repoRoot, requestedPath, { access: "write" });
}

export function isMarkdownPath(relativePath: string): boolean {
  return relativePath.toLowerCase().endsWith(".md");
}

export function isRawPath(relativePath: string): boolean {
  return (
    relativePath === "raw" ||
    relativePath.startsWith("raw/") ||
    relativePath === "wiki/raw" ||
    relativePath.startsWith("wiki/raw/")
  );
}

export function isBlockedPathSegment(segment: string): boolean {
  return BLOCKED_PATH_SEGMENTS.has(segment);
}

function isPathInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function rejectBlockedSegments(relativePath: string): void {
  const segments = relativePath.split("/");
  const blocked = segments.find((segment) => isBlockedPathSegment(segment));
  if (blocked !== undefined) {
    throw new PolicyViolationError(
      "blocked_path_segment",
      `Path includes blocked segment "${blocked}": ${relativePath}`,
    );
  }
}

function toPosixPath(value: string): string {
  return value.split(path.sep).join("/");
}
