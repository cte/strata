#!/usr/bin/env bun
import { loadDotenv, repoRoot } from "./common.js";
import { pullNotionPage } from "./notion.js";

type Args = {
  pageId: string;
  dryRun: boolean;
};

function parseArgs(argv: string[]): Args {
  const args: Partial<Args> = { dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      console.log("usage: pullNotion --page-id PAGE_ID_OR_URL [--dry-run]");
      process.exit(0);
    }
    if (arg === "--page-id") {
      const value = argv[++index];
      if (value === undefined || value.trim() === "") {
        throw new Error("--page-id requires a value");
      }
      args.pageId = value;
    } else if (arg === "--dry-run") {
      args.dryRun = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (args.pageId === undefined || args.pageId.trim() === "") {
    throw new Error("--page-id is required");
  }
  return { pageId: args.pageId, dryRun: args.dryRun ?? false };
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  await loadDotenv();
  const token = process.env["NOTION_TOKEN"] ?? "";
  if (token === "") {
    console.error("Set NOTION_TOKEN in .env.");
    return 2;
  }

  const version = process.env["NOTION_VERSION"];
  const result = await pullNotionPage({
    pageId: args.pageId,
    repoRoot,
    token,
    dryRun: args.dryRun,
    ...(version === undefined ? {} : { version }),
  });

  if (result.dryRun) {
    console.log(result.path);
  } else if (result.written) {
    console.log(`wrote ${result.path}`);
  } else {
    console.log(`skipped existing ${result.path}`);
  }
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
