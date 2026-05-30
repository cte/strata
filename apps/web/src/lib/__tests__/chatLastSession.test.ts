import { describe, expect, test } from "bun:test";
import {
  type ChatLastSessionStorage,
  clearLastChatSessionId,
  LAST_CHAT_SESSION_STORAGE_KEY,
  readLastChatSessionId,
  writeLastChatSessionId,
} from "@/lib/chatLastSession";

class MemoryStorage implements ChatLastSessionStorage {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

describe("chat last session storage", () => {
  test("round trips the most recently viewed session id", () => {
    const storage = new MemoryStorage();

    writeLastChatSessionId("session-123", storage);

    expect(readLastChatSessionId(storage)).toBe("session-123");
    expect(storage.getItem(LAST_CHAT_SESSION_STORAGE_KEY)).toBe(JSON.stringify("session-123"));
  });

  test("returns null for missing or empty values", () => {
    const storage = new MemoryStorage();

    expect(readLastChatSessionId(storage)).toBeNull();

    storage.setItem(LAST_CHAT_SESSION_STORAGE_KEY, JSON.stringify(""));
    expect(readLastChatSessionId(storage)).toBeNull();
  });

  test("clears only the matching stored session id", () => {
    const storage = new MemoryStorage();
    writeLastChatSessionId("session-123", storage);

    clearLastChatSessionId("other-session", storage);
    expect(readLastChatSessionId(storage)).toBe("session-123");

    clearLastChatSessionId("session-123", storage);
    expect(readLastChatSessionId(storage)).toBeNull();
  });
});
