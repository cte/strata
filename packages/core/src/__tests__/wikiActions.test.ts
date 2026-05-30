import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  addWikiAction,
  deleteWikiAction,
  listWikiActions,
  parseWikiActionContent,
  updateWikiAction,
} from "../wikiActions.js";

describe("wiki actions", () => {
  test("parses action ledgers with sources and hidden context metadata", () => {
    const items = parseWikiActionContent(
      "mine",
      "wiki/actions/mine.md",
      [
        "---",
        "type: actions",
        "owner: me",
        "last_updated: 2026-05-08",
        "---",
        "",
        "# What I Owe Others",
        "",
        "- [ ] Follow up on the plan (source: [[meetings/2026-05-01-sync|May sync]])",
        '  <!-- strata:action-context {"context":"Waiting on contract notes.","updatedAt":"2026-05-28T10:00:00.000Z"} -->',
        "- [x] Close the old thread",
        "",
      ].join("\n"),
    );

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      owner: "mine",
      ownerLabel: "Mine",
      line: 9,
      completed: false,
      title: "Follow up on the plan",
      context: "Waiting on contract notes.",
      contextUpdatedAt: "2026-05-28T10:00:00.000Z",
      sourceDate: "2026-05-01",
      source: {
        target: "meetings/2026-05-01-sync",
        label: "May sync",
      },
    });
    expect(items[1]).toMatchObject({
      completed: true,
      title: "Close the old thread",
      context: "",
    });
  });

  test("lists actions with owner, status, and query filters", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-actions-"));
    try {
      await writeActionFile(repoRoot, "mine", [
        "- [ ] Draft roadmap update",
        "- [x] Send launch note",
        '  <!-- strata:action-context {"context":"Sent in Slack.","updatedAt":"2026-05-28T10:00:00.000Z"} -->',
      ]);
      await writeActionFile(repoRoot, "theirs", ["- [ ] Review importer proposal"]);

      const open = await listWikiActions(repoRoot);
      expect(open.map((item) => item.title)).toEqual([
        "Draft roadmap update",
        "Review importer proposal",
      ]);

      const doneMine = await listWikiActions(repoRoot, { owner: "mine", status: "done" });
      expect(doneMine.map((item) => item.title)).toEqual(["Send launch note"]);

      const queried = await listWikiActions(repoRoot, { status: "all", query: "importer" });
      expect(queried.map((item) => item.owner)).toEqual(["theirs"]);
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("updates completion and context without changing the visible action text", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-actions-"));
    try {
      await writeActionFile(repoRoot, "mine", [
        "- [ ] Follow up on billing (source: [[meetings/billing|Billing]])",
      ]);
      const [item] = await listWikiActions(repoRoot, { status: "all" });
      if (item === undefined) {
        throw new Error("Expected a parsed action item.");
      }

      const updated = await updateWikiAction(repoRoot, {
        id: item.id,
        completed: true,
        context: "Sent the summary and asked for the missing invoice ID.",
        now: new Date("2026-05-28T12:00:00.000Z"),
      });

      expect(updated.completed).toBe(true);
      expect(updated.context).toBe("Sent the summary and asked for the missing invoice ID.");
      const file = await readFile(path.join(repoRoot, "wiki/actions/mine.md"), "utf8");
      expect(file).toContain("last_updated: 2026-05-28");
      expect(file).toContain("- [x] Follow up on billing (source: [[meetings/billing|Billing]])");
      expect(file).toContain("strata:action-context");
      expect(file).toContain("Sent the summary");
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("adds manual actions to the selected wiki ledger", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-actions-"));
    try {
      const item = await addWikiAction(repoRoot, {
        owner: "theirs",
        title: "  Review the revised action UI  ",
        context: "Need a pass before the next ingest sweep.",
        now: new Date("2026-05-28T12:00:00.000Z"),
      });

      expect(item).toMatchObject({
        owner: "theirs",
        completed: false,
        title: "Review the revised action UI",
        context: "Need a pass before the next ingest sweep.",
        createdAt: "2026-05-28T12:00:00.000Z",
        contextUpdatedAt: "2026-05-28T12:00:00.000Z",
        path: "wiki/actions/theirs.md",
      });
      const file = await readFile(path.join(repoRoot, "wiki/actions/theirs.md"), "utf8");
      expect(file).toContain("owner: others");
      expect(file).toContain("# What Others Owe Me");
      expect(file).toContain("- [ ] Review the revised action UI");
      expect(file).toContain('"createdAt":"2026-05-28T12:00:00.000Z"');
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("adds source links and preserves custom metadata when context changes", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-actions-"));
    try {
      const item = await addWikiAction(repoRoot, {
        owner: "mine",
        title: "Prepare the launch checklist",
        context: "Imported from launch notes.",
        source: {
          target: "raw/slack/2026-05-09-launch",
          label: "Launch thread",
        },
        metadata: {
          sourceRecordId: "launch_abc123",
          sourceRecordKind: "manual_import",
          lineStart: 10,
        },
        now: new Date("2026-05-28T12:00:00.000Z"),
      });

      expect(item).toMatchObject({
        title: "Prepare the launch checklist",
        source: {
          target: "raw/slack/2026-05-09-launch",
          label: "Launch thread",
        },
      });

      await updateWikiAction(repoRoot, {
        id: item.id,
        context: "Confirmed with Sam.",
        now: new Date("2026-05-28T13:00:00.000Z"),
      });
      await updateWikiAction(repoRoot, {
        id: item.id,
        context: "",
        now: new Date("2026-05-28T14:00:00.000Z"),
      });

      const file = await readFile(path.join(repoRoot, "wiki/actions/mine.md"), "utf8");
      expect(file).toContain(
        "- [ ] Prepare the launch checklist (source: [[raw/slack/2026-05-09-launch|Launch thread]])",
      );
      expect(file).toContain('"sourceRecordId":"launch_abc123"');
      expect(file).toContain('"sourceRecordKind":"manual_import"');
      expect(file).toContain('"lineStart":10');
      expect(file).not.toContain('"context":"Confirmed with Sam."');
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("dates manually added actions even without visible context", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-actions-"));
    try {
      const item = await addWikiAction(repoRoot, {
        owner: "mine",
        title: "Review today's focus list",
        now: new Date("2026-05-28T12:00:00.000Z"),
      });

      expect(item).toMatchObject({
        title: "Review today's focus list",
        context: "",
        createdAt: "2026-05-28T12:00:00.000Z",
      });
      const file = await readFile(path.join(repoRoot, "wiki/actions/mine.md"), "utf8");
      expect(file).toContain('strata:action-context {"createdAt":"2026-05-28T12:00:00.000Z"}');
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("deletes an action item and its hidden context line", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-actions-"));
    try {
      await writeActionFile(repoRoot, "mine", [
        "- [ ] Draft roadmap update",
        '  <!-- strata:action-context {"context":"Waiting on numbers.","updatedAt":"2026-05-28T10:00:00.000Z"} -->',
        "- [ ] Keep this one",
      ]);
      const [target] = await listWikiActions(repoRoot, { status: "all", query: "roadmap" });
      if (target === undefined) {
        throw new Error("Expected a parsed action item.");
      }

      const result = await deleteWikiAction(repoRoot, {
        id: target.id,
        now: new Date("2026-05-29T12:00:00.000Z"),
      });
      expect(result.deleted).toBe(true);

      const remaining = await listWikiActions(repoRoot, { status: "all" });
      expect(remaining.map((item) => item.title)).toEqual(["Keep this one"]);
      const file = await readFile(path.join(repoRoot, "wiki/actions/mine.md"), "utf8");
      expect(file).not.toContain("Draft roadmap update");
      expect(file).not.toContain("Waiting on numbers.");
      expect(file).toContain("- [ ] Keep this one");
      expect(file).toContain("last_updated: 2026-05-29");
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("rejects deleting an unknown action id", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-actions-"));
    try {
      await writeActionFile(repoRoot, "mine", ["- [ ] Only item"]);
      await expect(
        deleteWikiAction(repoRoot, { id: "wiki_action_mine_0000000000000000_1" }),
      ).rejects.toThrow(/not found/);
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });
});

async function writeActionFile(
  repoRoot: string,
  owner: "mine" | "theirs",
  items: string[],
): Promise<void> {
  const actionDir = path.join(repoRoot, "wiki/actions");
  await mkdir(actionDir, { recursive: true });
  await writeFile(
    path.join(actionDir, `${owner}.md`),
    [
      "---",
      "type: actions",
      `owner: ${owner === "mine" ? "me" : "others"}`,
      "last_updated: 2026-05-08",
      "---",
      "",
      owner === "mine" ? "# What I Owe Others" : "# What Others Owe Me",
      "",
      ...items,
      "",
    ].join("\n"),
    "utf8",
  );
}
