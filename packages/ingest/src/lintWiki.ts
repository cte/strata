#!/usr/bin/env bun
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  appendLog,
  dateDiffDays,
  parseIsoDate,
  slugify,
  splitFrontmatter,
  todayIso,
  wikiRoot,
} from "./common.js";

const skipDirs = new Set([".git", "dist", "docs", "meta", "node_modules", "raw", "tools"]);
const skipOrphanNames = new Set([
  "AGENTS.md",
  "CLAUDE.md",
  "index.md",
  "log.md",
  "me.md",
  "priorities.md",
  "mine.md",
  "theirs.md",
]);

type Args = {
  dryRun: boolean;
};

function parseArgs(argv: string[]): Args {
  const args: Args = { dryRun: false };
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      console.log("usage: lintWiki [--dry-run]");
      process.exit(0);
    }
    if (arg === "--dry-run") {
      args.dryRun = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

async function markdownFiles(dir = wikiRoot): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!skipDirs.has(entry.name)) {
        files.push(...(await markdownFiles(fullPath)));
      }
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(fullPath);
    }
  }
  return files.sort();
}

function wikilinks(text: string): string[] {
  return [...text.matchAll(/\[\[([^\]|#]+)/g)].map((match) => match[1] ?? "");
}

function pageKey(filePath: string): string {
  return slugify(path.basename(filePath, ".md"));
}

function actionDueDates(text: string): { lineNumber: number; due: Date; line: string }[] {
  const found: { lineNumber: number; due: Date; line: string }[] = [];
  const patterns = [
    /- \[ \].*?\bdue:\s*(\d{4}-\d{2}-\d{2})/i,
    /- \[ \].*?@due\((\d{4}-\d{2}-\d{2})\)/i,
  ];
  const lines = text.split(/\r?\n/);
  lines.forEach((line, index) => {
    for (const pattern of patterns) {
      const match = pattern.exec(line);
      const due = parseIsoDate(match?.[1]);
      if (due) {
        found.push({ lineNumber: index + 1, due, line: line.trim() });
      }
    }
  });
  return found;
}

function formatList(items: string[]): string {
  return items.length === 0 ? "- None found." : items.map((item) => `- ${item}`).join("\n");
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const today = parseIsoDate(todayIso());
  if (!today) {
    throw new Error("Could not parse current date");
  }

  const files = await markdownFiles();
  const bodies = new Map<string, string>();
  const metadata = new Map<string, Record<string, string>>();
  const inbound = new Map<string, Set<string>>();
  const missingFrontmatter: string[] = [];

  for (const filePath of files) {
    const text = await readFile(filePath, "utf8");
    const { metadata: fm, body } = splitFrontmatter(text);
    bodies.set(filePath, body);
    metadata.set(filePath, fm);
    if (!skipOrphanNames.has(path.basename(filePath)) && Object.keys(fm).length === 0) {
      missingFrontmatter.push(path.relative(wikiRoot, filePath));
    }
    for (const link of wikilinks(text)) {
      const key = slugify(path.basename(link, ".md"));
      const pages = inbound.get(key) ?? new Set<string>();
      pages.add(filePath);
      inbound.set(key, pages);
    }
  }

  const staleThreads: string[] = [];
  const missingDecisions: string[] = [];
  const orphanPages: string[] = [];
  const overdueActions: string[] = [];
  const stalePriorities: string[] = [];

  for (const [filePath, fm] of metadata.entries()) {
    const rel = path.relative(wikiRoot, filePath);
    const pageType = fm["type"] ?? "";
    if (pageType === "thread" && (fm["status"] ?? "open") === "open") {
      const opened = parseIsoDate(fm["opened"]);
      if (opened && dateDiffDays(today, opened) > 30) {
        staleThreads.push(
          `${rel} opened ${opened.toISOString().slice(0, 10)} (${dateDiffDays(today, opened)} days old)`,
        );
      }
    }

    if (path.basename(filePath) === "priorities.md") {
      const lastUpdated = parseIsoDate(fm["last_updated"]);
      if (!lastUpdated) {
        stalePriorities.push("priorities.md has no `last_updated` date.");
      } else if (dateDiffDays(today, lastUpdated) > 30) {
        stalePriorities.push(
          `priorities.md last updated ${lastUpdated.toISOString().slice(0, 10)} (${dateDiffDays(today, lastUpdated)} days old)`,
        );
      }
    }

    const topLevelDir = rel.split(path.sep)[0];
    if (
      topLevelDir &&
      ["people", "projects", "teams", "meetings", "decisions", "threads"].includes(topLevelDir)
    ) {
      if (!skipOrphanNames.has(path.basename(filePath)) && !inbound.has(pageKey(filePath))) {
        orphanPages.push(rel);
      }
    }

    if (topLevelDir === "actions") {
      const text = await readFile(filePath, "utf8");
      for (const { lineNumber, due, line } of actionDueDates(text)) {
        if (due < today) {
          overdueActions.push(
            `${rel}:${lineNumber} due ${due.toISOString().slice(0, 10)} | ${line}`,
          );
        }
      }
    }
  }

  const decisionKeys = new Set<string>();
  for (const filePath of files) {
    if (path.relative(wikiRoot, filePath).startsWith(`decisions${path.sep}`)) {
      decisionKeys.add(pageKey(filePath));
    }
  }

  for (const [filePath, body] of bodies.entries()) {
    for (const link of wikilinks(body)) {
      const key = slugify(path.basename(link, ".md"));
      if (/^\d{4}-\d{2}-\d{2}-/.test(key) && key.includes("decision") && !decisionKeys.has(key)) {
        missingDecisions.push(
          `${path.relative(wikiRoot, filePath)} links to missing decision \`[[${link}]]\``,
        );
      }
    }
  }

  const report = `# Wiki Lint — ${today.toISOString().slice(0, 10)}

## Open Threads Older Than 30 Days

${formatList(staleThreads)}

## Stale Priorities

${formatList(stalePriorities)}

## Decisions Referenced But Missing

${formatList([...new Set(missingDecisions)].sort())}

## Orphan Pages

${formatList(orphanPages)}

## Missing Frontmatter

${formatList(missingFrontmatter)}

## Overdue Action Items

${formatList(overdueActions)}
`;

  const output = path.join(wikiRoot, "meta", "lint", `lint-${today.toISOString().slice(0, 10)}.md`);
  if (args.dryRun) {
    console.log(report);
    return 0;
  }
  await writeFile(output, report, "utf8");
  await appendLog("lint", today.toISOString().slice(0, 10));
  console.log(`wrote ${path.relative(wikiRoot, output)}`);
  return 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  },
);
