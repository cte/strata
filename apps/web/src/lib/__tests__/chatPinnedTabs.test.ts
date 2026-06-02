import { describe, expect, test } from "bun:test";
import { CHAT_NEW_TAB_KEY, useChatPinnedTabsStore } from "@/lib/chatPinnedTabs";

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
