import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { FileMentionProvider } from "./fileMentions.js";

async function makeRepo(layout: Record<string, string>): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "cortex-mentions-"));
  for (const [relativePath, content] of Object.entries(layout)) {
    const full = path.join(root, relativePath);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, content, "utf8");
  }
  return root;
}

async function waitForCache(provider: FileMentionProvider, attempts = 20): Promise<void> {
  for (let i = 0; i < attempts; i += 1) {
    // Force a refresh tick; provide() lazily kicks one off.
    provider.provide("@", 1);
    // Small delay to let the rg child exit.
    await new Promise((resolve) => setTimeout(resolve, 25));
    const result = provider.provide("@", 1);
    if (result !== undefined && result.items.length > 0) return;
  }
}

describe("FileMentionProvider", () => {
  test("scopes search to the entire repo and ranks by filename match", async () => {
    const repo = await makeRepo({
      "wiki/projects/alpha.md": "# Alpha\n",
      "wiki/people/alice.md": "# Alice\n",
      "src/utils/alpha.ts": "export const x = 1;\n",
      "README.md": "readme\n",
    });
    try {
      const provider = new FileMentionProvider(repo);
      await waitForCache(provider);

      // Bare `@` returns up to 20 entries from the cache.
      const bare = provider.provide("@", 1);
      expect(bare?.items.length).toBeGreaterThan(0);

      // Filename match wins over path match: querying "alpha" returns both
      // alpha.md and alpha.ts ahead of files that only contain "alpha" in path.
      const alpha = provider.provide("@alpha", 6);
      expect(alpha?.items.map((i) => i.value)).toEqual(
        expect.arrayContaining(["@src/utils/alpha.ts", "@wiki/projects/alpha.md"]),
      );

      // Suggestions show filename as label and full path as description.
      const first = alpha?.items[0];
      expect(first?.label).toBe("alpha.ts");
      expect(first?.description).toBe("src/utils/alpha.ts");

      // No match → no suggestions.
      const none = provider.provide("@xyzzy", 6);
      expect(none).toBeUndefined();
    } finally {
      await rm(repo, { force: true, recursive: true });
    }
  });

  test("ignores @-mentions inside email-like strings", async () => {
    const repo = await makeRepo({ "wiki/index.md": "" });
    try {
      const provider = new FileMentionProvider(repo);
      await waitForCache(provider);
      const result = provider.provide("ping cestreich@gmail.com", 24);
      expect(result).toBeUndefined();
    } finally {
      await rm(repo, { force: true, recursive: true });
    }
  });

  test("surfaces directories alongside files with a trailing slash", async () => {
    const repo = await makeRepo({
      "wiki/projects/alpha.md": "",
      "wiki/projects/notes/meeting.md": "",
    });
    try {
      const provider = new FileMentionProvider(repo);
      await waitForCache(provider);
      const result = provider.provide("@projects", 9);
      // Directory and files all show; directories carry a `/` suffix in label
      // and value, and pi's +10 dir bonus floats them above files of equal
      // basename match strength.
      const projectsItem = result?.items.find((item) => item.label === "projects/");
      expect(projectsItem).toBeDefined();
      expect(projectsItem?.value).toBe("@wiki/projects/");
    } finally {
      await rm(repo, { force: true, recursive: true });
    }
  });

  test("matches regardless of case", async () => {
    const repo = await makeRepo({ "wiki/projects/Alpha-Beta.md": "" });
    try {
      const provider = new FileMentionProvider(repo);
      await waitForCache(provider);
      const result = provider.provide("@alpha", 6);
      expect(result?.items[0]?.label).toBe("Alpha-Beta.md");
    } finally {
      await rm(repo, { force: true, recursive: true });
    }
  });
});
