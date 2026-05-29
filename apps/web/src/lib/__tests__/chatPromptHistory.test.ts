import { describe, expect, test } from "bun:test";
import {
  appendPromptHistoryEntry,
  navigatePromptHistory,
  readPromptHistory,
  writePromptHistory,
} from "../useChatPromptHistory.js";

describe("chat prompt history", () => {
  test("reads and writes localStorage-backed prompt arrays", () => {
    const storage = new MemoryStorage();
    writePromptHistory(storage, ["first", "second"]);
    expect(readPromptHistory(storage)).toEqual(["first", "second"]);
    storage.setItem("strata:chat:prompts", "{bad json");
    expect(readPromptHistory(storage)).toEqual([]);
  });

  test("dedupes the latest entry and caps history", () => {
    expect(appendPromptHistoryEntry(["hello"], "hello")).toEqual(["hello"]);
    expect(appendPromptHistoryEntry(["hello"], " next ")).toEqual(["hello", "next"]);
    const many = Array.from({ length: 101 }, (_, index) => `prompt ${index}`);
    const capped = appendPromptHistoryEntry(many, "last");
    expect(capped).toHaveLength(100);
    expect(capped[0]).toBe("prompt 2");
    expect(capped.at(-1)).toBe("last");
  });

  test("walks backward and forward without wrapping", () => {
    const entries = ["one", "two"];
    const first = navigatePromptHistory({ entries, draft: "draft" }, -1);
    expect(first.value).toBe("two");
    const second = navigatePromptHistory(first.navigator, -1);
    expect(second.value).toBe("one");
    const pastOldest = navigatePromptHistory(second.navigator, -1);
    expect(pastOldest.value).toBeUndefined();
    const forward = navigatePromptHistory(second.navigator, 1);
    expect(forward.value).toBe("two");
    const draft = navigatePromptHistory(forward.navigator, 1);
    expect(draft.value).toBe("draft");
  });
});

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}
