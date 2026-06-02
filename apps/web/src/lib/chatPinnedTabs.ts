import { create } from "zustand";
import type { PersistStorage, StorageValue } from "zustand/middleware";
import { persist } from "zustand/middleware";
import type { ChatSessionSummary } from "@/lib/api";
import { sanitizeDisplayText } from "@/lib/chatRunModel";

export const CHAT_NEW_TAB_KEY = "new";
/** Title shown on the placeholder tab for a not-yet-persisted new chat. */
export const CHAT_NEW_TAB_TITLE = "New session";
const STORAGE_KEY = "strata:chat:pinned-tabs";
const memoryValues = new Map<string, string>();

type PersistedChatPinnedTabsState = Pick<ChatPinnedTabsState, "tabs">;

const chatPinnedTabsStorage: PersistStorage<PersistedChatPinnedTabsState> = {
  getItem: (name) => parseStoredValue(readStorageValue(name)),
  setItem: (name, value) => {
    writeStorageValue(name, JSON.stringify(value));
  },
  removeItem: (name) => {
    if (typeof window === "undefined") {
      memoryValues.delete(name);
      return;
    }
    window.localStorage.removeItem(name);
  },
};

export interface ChatPinnedTab {
  key: string;
  sessionId: string | null;
  titleSnapshot: string;
  activatedAt: number;
}

interface ChatPinnedTabsState {
  tabs: ChatPinnedTab[];
  drafts: Record<string, string>;
  ensureNewTab(now?: number): void;
  activateSession(sessionId: string, title?: string | null, now?: number): void;
  replaceNewWithSession(sessionId: string, title?: string | null, now?: number): void;
  closeTab(key: string, activeKey: string): ChatPinnedTab | null;
  removeSession(sessionId: string, activeKey: string): ChatPinnedTab | null;
  reorderTabs(activeKey: string, overKey: string): void;
  renameSession(sessionId: string, title: string): void;
  setDraft(key: string, value: string): void;
  clearDraft(key: string): void;
  syncSessions(sessions: ChatSessionSummary[], options?: { pruneMissing?: boolean }): void;
}

export const useChatPinnedTabsStore = create<ChatPinnedTabsState>()(
  persist(
    (set, get) => ({
      tabs: [],
      drafts: {},
      ensureNewTab(now = Date.now()) {
        set((state) => ({ tabs: ensureNewTabPresent(state.tabs, now) }));
      },
      activateSession(sessionId, title, now = Date.now()) {
        set((state) => ({ tabs: activateSessionTab(state.tabs, sessionId, title, now) }));
      },
      replaceNewWithSession(sessionId, title, now = Date.now()) {
        set((state) => ({
          tabs: replaceNewTabWithSession(state.tabs, sessionId, title, now),
          drafts: moveDraft(state.drafts, CHAT_NEW_TAB_KEY, sessionId),
        }));
      },
      closeTab(key, activeKey) {
        const state = get();
        const result = closePinnedTab(state.tabs, state.drafts, key, activeKey);
        set({ tabs: result.tabs, drafts: result.drafts });
        return result.nextActive;
      },
      removeSession(sessionId, activeKey) {
        const state = get();
        const result = closePinnedTab(state.tabs, state.drafts, sessionId, activeKey);
        set({ tabs: result.tabs, drafts: result.drafts });
        return result.nextActive;
      },
      reorderTabs(activeKey, overKey) {
        set((state) => ({ tabs: reorderPinnedTabs(state.tabs, activeKey, overKey) }));
      },
      renameSession(sessionId, title) {
        set((state) => ({
          tabs: state.tabs.map((tab) =>
            tab.sessionId === sessionId
              ? { ...tab, titleSnapshot: sanitizeDisplayText(title) }
              : tab,
          ),
        }));
      },
      setDraft(key, value) {
        set((state) => ({
          drafts: value === "" ? omitKey(state.drafts, key) : { ...state.drafts, [key]: value },
        }));
      },
      clearDraft(key) {
        set((state) => ({ drafts: omitKey(state.drafts, key) }));
      },
      syncSessions(sessions, options) {
        // Keep the not-yet-persisted placeholder (sessionId === null) so a fresh
        // "New session" tab survives sessions-list refreshes; the sync helper
        // passes it through untouched and only reconciles persisted tabs.
        set((state) => ({
          tabs: syncPinnedTabsWithSessions(state.tabs, sessions, options?.pruneMissing ?? false),
        }));
      },
    }),
    {
      name: STORAGE_KEY,
      storage: chatPinnedTabsStorage,
      partialize: (state) => ({ tabs: state.tabs.filter((tab) => tab.sessionId !== null) }),
    },
  ),
);

export function chatTabKeyForSession(sessionId: string | null): string {
  return sessionId ?? CHAT_NEW_TAB_KEY;
}

/**
 * Ensures a single placeholder tab for the not-yet-persisted new chat exists.
 * Idempotent: if a `CHAT_NEW_TAB_KEY` tab is already present it is left in
 * place (order and `activatedAt` preserved) so repeated calls don't churn it.
 */
function ensureNewTabPresent(tabs: ChatPinnedTab[], now: number): ChatPinnedTab[] {
  if (tabs.some((tab) => tab.key === CHAT_NEW_TAB_KEY)) {
    return tabs;
  }
  return [
    ...tabs,
    {
      key: CHAT_NEW_TAB_KEY,
      sessionId: null,
      titleSnapshot: CHAT_NEW_TAB_TITLE,
      activatedAt: now,
    },
  ];
}

function activateSessionTab(
  tabs: ChatPinnedTab[],
  sessionId: string,
  title: string | null | undefined,
  now: number,
): ChatPinnedTab[] {
  const existing = tabs.find((tab) => tab.sessionId === sessionId);
  const snapshot = titleSnapshot(title, sessionId, existing?.titleSnapshot);
  if (existing !== undefined) {
    return tabs.map((tab) =>
      tab.sessionId === sessionId ? { ...tab, titleSnapshot: snapshot, activatedAt: now } : tab,
    );
  }
  return [...tabs, { key: sessionId, sessionId, titleSnapshot: snapshot, activatedAt: now }];
}

function replaceNewTabWithSession(
  tabs: ChatPinnedTab[],
  sessionId: string,
  title: string | null | undefined,
  now: number,
): ChatPinnedTab[] {
  // Already pinned (e.g. a second submit) — just refresh it in place.
  const existingIndex = tabs.findIndex((tab) => tab.sessionId === sessionId);
  if (existingIndex >= 0) {
    const existing = tabs[existingIndex];
    const snapshot = titleSnapshot(title, sessionId, existing?.titleSnapshot);
    return tabs.map((tab) =>
      tab.sessionId === sessionId ? { ...tab, titleSnapshot: snapshot, activatedAt: now } : tab,
    );
  }
  // Convert the placeholder tab in place so the persisted session keeps the
  // slot (and order) the user was already looking at.
  const placeholderIndex = tabs.findIndex((tab) => tab.key === CHAT_NEW_TAB_KEY);
  if (placeholderIndex >= 0) {
    const snapshot = titleSnapshot(title, sessionId, undefined);
    return tabs.map((tab) =>
      tab.key === CHAT_NEW_TAB_KEY
        ? { key: sessionId, sessionId, titleSnapshot: snapshot, activatedAt: now }
        : tab,
    );
  }
  const snapshot = titleSnapshot(title, sessionId, undefined);
  return [...tabs, { key: sessionId, sessionId, titleSnapshot: snapshot, activatedAt: now }];
}

function closePinnedTab(
  tabs: ChatPinnedTab[],
  drafts: Record<string, string>,
  key: string,
  activeKey: string,
): { tabs: ChatPinnedTab[]; drafts: Record<string, string>; nextActive: ChatPinnedTab | null } {
  const index = tabs.findIndex((tab) => tab.key === key);
  if (index < 0) {
    return { tabs, drafts, nextActive: null };
  }
  const nextTabs = tabs.filter((tab) => tab.key !== key);
  const nextActive =
    key === activeKey ? (nextTabs[Math.max(0, index - 1)] ?? nextTabs[0] ?? null) : null;
  return { tabs: nextTabs, drafts: omitKey(drafts, key), nextActive };
}

function reorderPinnedTabs(
  tabs: ChatPinnedTab[],
  activeKey: string,
  overKey: string,
): ChatPinnedTab[] {
  if (activeKey === overKey) {
    return tabs;
  }
  const from = tabs.findIndex((tab) => tab.key === activeKey);
  const to = tabs.findIndex((tab) => tab.key === overKey);
  if (from < 0 || to < 0) {
    return tabs;
  }
  const next = [...tabs];
  const [moved] = next.splice(from, 1);
  if (moved === undefined) {
    return tabs;
  }
  next.splice(to, 0, moved);
  return next;
}

function syncPinnedTabsWithSessions(
  tabs: ChatPinnedTab[],
  sessions: ChatSessionSummary[],
  pruneMissing: boolean,
): ChatPinnedTab[] {
  const sessionsById = new Map(sessions.map((session) => [session.id, session]));
  return tabs.flatMap((tab) => {
    if (tab.sessionId === null) {
      // Preserve the not-yet-persisted "New session" placeholder; it has no
      // server row to reconcile against and must outlive list refreshes.
      return [tab];
    }
    const session = sessionsById.get(tab.sessionId);
    if (session === undefined) {
      return pruneMissing ? [] : [tab];
    }
    const title = sanitizeDisplayText(session.title);
    return title === tab.titleSnapshot ? [tab] : [{ ...tab, titleSnapshot: title }];
  });
}

function titleSnapshot(
  title: string | null | undefined,
  sessionId: string,
  fallback?: string,
): string {
  return title === null || title === undefined
    ? (fallback ?? shortSessionId(sessionId))
    : sanitizeDisplayText(title);
}

function shortSessionId(sessionId: string): string {
  return sessionId.length <= 8 ? sessionId : sessionId.slice(0, 8);
}

function moveDraft(
  drafts: Record<string, string>,
  fromKey: string,
  toKey: string,
): Record<string, string> {
  const value = drafts[fromKey];
  if (value === undefined) {
    return drafts;
  }
  return { ...omitKey(drafts, fromKey), [toKey]: value };
}

function omitKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  if (!(key in record)) {
    return record;
  }
  const { [key]: _removed, ...rest } = record;
  return rest;
}

function readStorageValue(name: string): string | null {
  if (typeof window === "undefined") {
    return memoryValues.get(name) ?? null;
  }
  return window.localStorage.getItem(name);
}

function writeStorageValue(name: string, value: string): void {
  if (typeof window === "undefined") {
    memoryValues.set(name, value);
    return;
  }
  window.localStorage.setItem(name, value);
}

function parseStoredValue(value: string | null): StorageValue<PersistedChatPinnedTabsState> | null {
  if (value === null) {
    return null;
  }
  try {
    return JSON.parse(value) as StorageValue<PersistedChatPinnedTabsState>;
  } catch {
    return null;
  }
}
