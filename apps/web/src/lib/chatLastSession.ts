export interface ChatLastSessionStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const LAST_CHAT_SESSION_STORAGE_KEY = "strata:chat:last-session-id";

export function readLastChatSessionId(
  storage: ChatLastSessionStorage | undefined = browserLocalStorage(),
): string | null {
  if (storage === undefined) {
    return null;
  }
  try {
    return parseStoredSessionId(storage.getItem(LAST_CHAT_SESSION_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function writeLastChatSessionId(
  sessionId: string,
  storage: ChatLastSessionStorage | undefined = browserLocalStorage(),
): void {
  if (storage === undefined || sessionId.trim() === "") {
    return;
  }
  try {
    storage.setItem(LAST_CHAT_SESSION_STORAGE_KEY, JSON.stringify(sessionId));
  } catch {
    // Ignore storage failures; routing should remain usable without persistence.
  }
}

export function clearLastChatSessionId(
  sessionId: string,
  storage: ChatLastSessionStorage | undefined = browserLocalStorage(),
): void {
  if (storage === undefined) {
    return;
  }
  try {
    if (readLastChatSessionId(storage) === sessionId) {
      storage.removeItem(LAST_CHAT_SESSION_STORAGE_KEY);
    }
  } catch {
    // Ignore storage failures; stale values can be overwritten by the next viewed session.
  }
}

function parseStoredSessionId(rawValue: string | null): string | null {
  if (rawValue === null) {
    return null;
  }
  try {
    const parsed = JSON.parse(rawValue) as unknown;
    return typeof parsed === "string" && parsed.trim() !== "" ? parsed : null;
  } catch {
    // Older/manual values may be stored as a raw session id rather than JSON.
    return rawValue.trim() === "" ? null : rawValue;
  }
}

function browserLocalStorage(): ChatLastSessionStorage | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }
  return window.localStorage;
}
