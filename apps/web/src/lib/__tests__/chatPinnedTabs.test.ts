import { describe, expect, test } from "bun:test";
import { CHAT_NEW_TAB_KEY, CHAT_NEW_TAB_TITLE, useChatPinnedTabsStore } from "@/lib/chatPinnedTabs";

const store = useChatPinnedTabsStore;

function resetStore(): void {
  store.setState({ tabs: [], drafts: {} });
}

describe("chat pinned tabs", () => {
  test("appends reactivated sessions and preserves existing order", () => {
    resetStore();
    store.getState().activateSession("a", "Alpha", 1);
    store.getState().activateSession("b", "Beta", 2);
    store.getState().activateSession("a", "Alpha renamed", 3);

    expect(store.getState().tabs.map((tab) => tab.key)).toEqual(["a", "b"]);
    expect(store.getState().tabs[0]?.titleSnapshot).toBe("Alpha renamed");
  });

  test("pins the first real session and moves the new-chat draft", () => {
    resetStore();
    store.getState().setDraft(CHAT_NEW_TAB_KEY, "hello");
    store.getState().replaceNewWithSession("session-1", "Started", 2);

    expect(store.getState().tabs).toEqual([
      { key: "session-1", sessionId: "session-1", titleSnapshot: "Started", activatedAt: 2 },
    ]);
    expect(store.getState().drafts).toEqual({ "session-1": "hello" });
  });

  test("ensureNewTab adds a single placeholder and is idempotent", () => {
    resetStore();
    store.getState().activateSession("a", "Alpha", 1);
    store.getState().ensureNewTab(2);
    store.getState().ensureNewTab(3);

    expect(store.getState().tabs).toEqual([
      { key: "a", sessionId: "a", titleSnapshot: "Alpha", activatedAt: 1 },
      { key: CHAT_NEW_TAB_KEY, sessionId: null, titleSnapshot: CHAT_NEW_TAB_TITLE, activatedAt: 2 },
    ]);
  });

  test("converts the placeholder in place when the first turn persists", () => {
    resetStore();
    store.getState().activateSession("a", "Alpha", 1);
    store.getState().ensureNewTab(2);
    store.getState().setDraft(CHAT_NEW_TAB_KEY, "hello");
    store.getState().replaceNewWithSession("session-1", "Started", 3);

    // Placeholder keeps its slot (after "a") rather than appending anew.
    expect(store.getState().tabs).toEqual([
      { key: "a", sessionId: "a", titleSnapshot: "Alpha", activatedAt: 1 },
      { key: "session-1", sessionId: "session-1", titleSnapshot: "Started", activatedAt: 3 },
    ]);
    expect(store.getState().drafts).toEqual({ "session-1": "hello" });
  });

  test("sync preserves the not-yet-persisted placeholder", () => {
    resetStore();
    store.getState().ensureNewTab(1);

    store.getState().syncSessions([], { pruneMissing: true });

    expect(store.getState().tabs.map((tab) => tab.key)).toEqual([CHAT_NEW_TAB_KEY]);
  });

  test("closing the active tab chooses the nearest tab to the left", () => {
    resetStore();
    store.getState().activateSession("a", "Alpha", 1);
    store.getState().activateSession("b", "Beta", 2);
    store.getState().activateSession("c", "Gamma", 3);

    const next = store.getState().closeTab("b", "b");

    expect(next?.key).toBe("a");
    expect(store.getState().tabs.map((tab) => tab.key)).toEqual(["a", "c"]);
  });

  test("sync updates live titles and prunes only when the index is complete", () => {
    resetStore();
    store.getState().activateSession("a", "Old", 1);
    store.getState().activateSession("missing", "Missing", 2);

    store.getState().syncSessions(
      [
        {
          id: "a",
          title: "New",
          kind: "chat",
          status: "completed",
          startedAt: new Date(0).toISOString(),
          endedAt: null,
          model: null,
          firstPrompt: null,
        },
      ],
      { pruneMissing: true },
    );

    expect(store.getState().tabs.map((tab) => [tab.key, tab.titleSnapshot])).toEqual([
      ["a", "New"],
    ]);
  });
});
