import { describe, expect, test } from "bun:test";
import { createFileMentionProvider, findFileMentionToken } from "../fileMentionProvider.js";

describe("file mention provider", () => {
  test("detects active @ tokens with Pi-compatible boundaries", () => {
    expect(findFileMentionToken("@doc", 4)).toEqual({
      query: "doc",
      replaceStart: 0,
      replaceEnd: 4,
    });
    expect(findFileMentionToken("open (@doc", 10)).toEqual({
      query: "doc",
      replaceStart: 6,
      replaceEnd: 10,
    });
    expect(findFileMentionToken("name@example.com", 16)).toBeUndefined();
    expect(findFileMentionToken("@doc now", 8)).toBeUndefined();
  });

  test("maps files and directories into insertion items", async () => {
    const provider = createFileMentionProvider({
      listFiles: async () => [
        { path: "docs/web-chat-plan.md", isDirectory: false },
        { path: "packages/core", isDirectory: true },
      ],
    });
    const result = await provider.provide({
      text: "read @web",
      cursor: 9,
      signal: new AbortController().signal,
    });
    expect(result).toEqual({
      replaceStart: 5,
      replaceEnd: 9,
      items: [
        {
          label: "web-chat-plan.md",
          value: "@docs/web-chat-plan.md",
          description: "docs/web-chat-plan.md",
          kind: "file",
        },
        {
          label: "core/",
          value: "@packages/core/",
          description: "packages/core",
          kind: "directory",
        },
      ],
    });
  });
});
