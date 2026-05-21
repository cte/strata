import type * as React from "react";
import { useCallback, useRef } from "react";

export const CHAT_PROMPT_HISTORY_STORAGE_KEY = "strata:chat:prompts";
const MAX_PROMPT_HISTORY = 100;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface PromptHistoryNavigator {
  entries: string[];
  index?: number;
  draft: string;
}

export interface PromptHistoryNavigationResult {
  navigator: PromptHistoryNavigator;
  value?: string;
}

export interface UseChatPromptHistoryResult {
  record(prompt: string): void;
  onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>, value: string): boolean;
}

export function useChatPromptHistory(
  onValueChange: (value: string) => void,
  storage: StorageLike | undefined = browserStorage(),
): UseChatPromptHistoryResult {
  const entriesRef = useRef<string[] | undefined>(undefined);
  const navigatorRef = useRef<PromptHistoryNavigator>({
    entries: [],
    draft: "",
  });

  const ensureEntries = useCallback(() => {
    if (entriesRef.current === undefined) {
      entriesRef.current = readPromptHistory(storage);
      navigatorRef.current = { entries: entriesRef.current, draft: "" };
    }
    return entriesRef.current;
  }, [storage]);

  const record = useCallback(
    (prompt: string) => {
      const next = appendPromptHistoryEntry(ensureEntries(), prompt);
      entriesRef.current = next;
      navigatorRef.current = { entries: next, draft: "" };
      writePromptHistory(storage, next);
    },
    [ensureEntries, storage],
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>, value: string): boolean => {
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") {
        navigatorRef.current = { entries: ensureEntries(), draft: "" };
        return false;
      }
      if (!canNavigateHistory(event.currentTarget)) {
        return false;
      }
      const direction = event.key === "ArrowUp" ? -1 : 1;
      const result = navigatePromptHistory(
        navigatorRef.current.index === undefined
          ? { entries: ensureEntries(), draft: value }
          : navigatorRef.current,
        direction,
      );
      if (result.value === undefined) {
        return false;
      }
      event.preventDefault();
      navigatorRef.current = result.navigator;
      onValueChange(result.value);
      window.requestAnimationFrame(() => {
        const cursor = result.value?.length ?? 0;
        event.currentTarget.setSelectionRange(cursor, cursor);
      });
      return true;
    },
    [ensureEntries, onValueChange],
  );

  return { record, onKeyDown };
}

export function readPromptHistory(storage: StorageLike | undefined): string[] {
  if (storage === undefined) {
    return [];
  }
  const raw = storage.getItem(CHAT_PROMPT_HISTORY_STORAGE_KEY);
  if (raw === null || raw.trim() === "") {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((entry): entry is string => typeof entry === "string" && entry !== "");
  } catch {
    return [];
  }
}

export function writePromptHistory(storage: StorageLike | undefined, entries: readonly string[]) {
  storage?.setItem(CHAT_PROMPT_HISTORY_STORAGE_KEY, JSON.stringify(entries));
}

export function appendPromptHistoryEntry(entries: readonly string[], prompt: string): string[] {
  const value = prompt.trim();
  if (value === "") {
    return [...entries];
  }
  if (entries.at(-1) === value) {
    return [...entries];
  }
  const next = [...entries, value];
  return next.length > MAX_PROMPT_HISTORY ? next.slice(-MAX_PROMPT_HISTORY) : next;
}

export function navigatePromptHistory(
  navigator: PromptHistoryNavigator,
  direction: -1 | 1,
): PromptHistoryNavigationResult {
  if (navigator.entries.length === 0) {
    return { navigator };
  }
  const currentIndex = navigator.index;
  const nextIndex =
    currentIndex === undefined
      ? direction < 0
        ? navigator.entries.length - 1
        : navigator.entries.length
      : currentIndex + direction;

  if (nextIndex < 0) {
    return { navigator };
  }
  if (nextIndex >= navigator.entries.length) {
    return {
      navigator: { entries: navigator.entries, draft: navigator.draft },
      value: navigator.draft,
    };
  }
  return {
    navigator: {
      entries: navigator.entries,
      index: nextIndex,
      draft: navigator.draft,
    },
    value: navigator.entries[nextIndex] ?? "",
  };
}

function canNavigateHistory(textarea: HTMLTextAreaElement): boolean {
  return (
    textarea.selectionStart === textarea.selectionEnd &&
    (textarea.value === "" || textarea.selectionStart === 0)
  );
}

function browserStorage(): StorageLike | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }
  return window.localStorage;
}
