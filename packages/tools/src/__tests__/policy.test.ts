import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { assertReadAllowed, assertWriteAllowed, PolicyViolationError } from "../policy.js";

describe("policy", () => {
  test("rejects paths outside the repo", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-policy-"));
    try {
      expect(() => assertReadAllowed(repoRoot, "../outside.md")).toThrow(PolicyViolationError);
      expect(() => assertWriteAllowed(repoRoot, "/tmp/outside.md")).toThrow(PolicyViolationError);
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("rejects writes under wiki/raw", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-policy-"));
    try {
      expect(() => assertWriteAllowed(repoRoot, "wiki/raw/granola/meeting.md")).toThrow(
        /Writes under raw\/ are forbidden/,
      );
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("allows explicit raw reads but rejects implicit raw reads", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-policy-"));
    try {
      expect(() => assertReadAllowed(repoRoot, "wiki/raw/granola/meeting.md")).toThrow(
        /requires includeRaw/,
      );
      expect(
        assertReadAllowed(repoRoot, "wiki/raw/granola/meeting.md", { allowRawRead: true })
          .relativePath,
      ).toBe("wiki/raw/granola/meeting.md");
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });
});
