import type * as React from "react";
import { useCallback, useEffect, useRef, useState } from "react";

export interface AutocompleteItem {
  label: string;
  value: string;
  description?: string;
  kind?: string;
  commit?: "insert" | "run";
}

export interface AutocompleteProviderInput {
  text: string;
  cursor: number;
  signal: AbortSignal;
}

export interface AutocompleteSuggestions {
  items: AutocompleteItem[];
  replaceStart: number;
  replaceEnd: number;
}

export interface AutocompleteProvider {
  id: string;
  provide(
    input: AutocompleteProviderInput,
  ): AutocompleteSuggestions | Promise<AutocompleteSuggestions | undefined> | undefined;
}

export interface UseAutocompleteOptions {
  value: string;
  providers: readonly AutocompleteProvider[];
  onValueChange(value: string): void;
  onCommit?(item: AutocompleteItem, value: string): void;
  disabled?: boolean;
  debounceMs?: number;
}

export interface UseAutocompleteResult {
  open: boolean;
  items: AutocompleteItem[];
  selectedIndex: number;
  anchorRect: DOMRect | null;
  onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>): boolean;
  accept(index?: number): void;
  dismiss(): void;
  select(index: number): void;
  refresh(): void;
}

interface ActiveSuggestions extends AutocompleteSuggestions {
  anchorRect: DOMRect | null;
}

const DEFAULT_DEBOUNCE_MS = 80;

export function useAutocomplete(
  textareaRef: React.RefObject<HTMLTextAreaElement | null>,
  options: UseAutocompleteOptions,
): UseAutocompleteResult {
  const {
    value,
    providers,
    onCommit,
    onValueChange,
    disabled = false,
    debounceMs = DEFAULT_DEBOUNCE_MS,
  } = options;
  const [suggestions, setSuggestions] = useState<ActiveSuggestions | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const requestIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const suggestionsRef = useRef<ActiveSuggestions | null>(null);
  const selectedIndexRef = useRef(0);
  const dismissedRef = useRef<{ value: string; cursor: number } | null>(null);
  const activeKeyRef = useRef<string | null>(null);

  useEffect(() => {
    suggestionsRef.current = suggestions;
  }, [suggestions]);

  useEffect(() => {
    selectedIndexRef.current = selectedIndex;
  }, [selectedIndex]);

  const dismiss = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    activeKeyRef.current = null;
    setSuggestions(null);
    setSelectedIndex(0);
  }, []);

  const refresh = useCallback(() => {
    const textarea = textareaRef.current;
    if (textarea === null || disabled || value === "" || providers.length === 0) {
      dismiss();
      return;
    }
    const cursor = textarea.selectionStart ?? value.length;
    const dismissed = dismissedRef.current;
    if (dismissed?.value === value && dismissed.cursor === cursor) {
      abortRef.current?.abort();
      abortRef.current = null;
      setSuggestions(null);
      setSelectedIndex(0);
      return;
    }
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    void (async () => {
      for (const provider of providers) {
        if (controller.signal.aborted) {
          return;
        }
        const result = await provider.provide({
          text: value,
          cursor,
          signal: controller.signal,
        });
        if (controller.signal.aborted || requestIdRef.current !== requestId) {
          return;
        }
        if (result !== undefined && result.items.length > 0) {
          const activeKey = [
            provider.id,
            value,
            cursor,
            result.replaceStart,
            result.replaceEnd,
          ].join("\0");
          const next: ActiveSuggestions = {
            ...result,
            anchorRect: textareaCaretRect(textarea, cursor),
          };
          setSuggestions(next);
          setSelectedIndex((current) =>
            activeKeyRef.current === activeKey ? clampIndex(current, result.items.length) : 0,
          );
          activeKeyRef.current = activeKey;
          return;
        }
      }
      if (!controller.signal.aborted && requestIdRef.current === requestId) {
        activeKeyRef.current = null;
        setSuggestions(null);
        setSelectedIndex(0);
      }
    })();
  }, [disabled, dismiss, providers, textareaRef, value]);

  useEffect(() => {
    if (disabled || value === "") {
      dismiss();
      return;
    }
    const timeout = window.setTimeout(refresh, debounceMs);
    return () => {
      window.clearTimeout(timeout);
    };
  }, [debounceMs, disabled, dismiss, refresh, value]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea === null) {
      return;
    }
    const handleSelection = () => {
      window.setTimeout(refresh, 0);
    };
    textarea.addEventListener("click", handleSelection);
    textarea.addEventListener("keyup", handleSelection);
    textarea.addEventListener("select", handleSelection);
    return () => {
      textarea.removeEventListener("click", handleSelection);
      textarea.removeEventListener("keyup", handleSelection);
      textarea.removeEventListener("select", handleSelection);
    };
  }, [refresh, textareaRef]);

  const accept = useCallback(
    (index?: number) => {
      const current = suggestionsRef.current;
      if (current === null || current.items.length === 0) {
        return;
      }
      const acceptedIndex = clampIndex(index ?? selectedIndexRef.current, current.items.length);
      const item = current.items[acceptedIndex];
      if (item === undefined) {
        return;
      }
      const nextValue =
        value.slice(0, current.replaceStart) + item.value + value.slice(current.replaceEnd);
      const nextCursor = current.replaceStart + item.value.length;
      dismissedRef.current = { value: nextValue, cursor: nextCursor };
      abortRef.current?.abort();
      abortRef.current = null;
      activeKeyRef.current = null;
      setSuggestions(null);
      setSelectedIndex(0);
      if (item.commit === "run" && onCommit !== undefined) {
        onCommit(item, nextValue);
        return;
      }
      onValueChange(nextValue);
      window.requestAnimationFrame(() => {
        const textarea = textareaRef.current;
        textarea?.focus();
        textarea?.setSelectionRange(nextCursor, nextCursor);
      });
    },
    [onCommit, onValueChange, textareaRef, value],
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>): boolean => {
      const current = suggestionsRef.current;
      if (current === null || current.items.length === 0) {
        return false;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setSelectedIndex((index) => (index + 1) % current.items.length);
        return true;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setSelectedIndex((index) => (index - 1 + current.items.length) % current.items.length);
        return true;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        accept();
        return true;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        dismissedRef.current = {
          value,
          cursor: textareaRef.current?.selectionStart ?? value.length,
        };
        dismiss();
        return true;
      }
      return false;
    },
    [accept, dismiss],
  );

  return {
    open: suggestions !== null && suggestions.items.length > 0,
    items: suggestions?.items ?? [],
    selectedIndex,
    anchorRect: suggestions?.anchorRect ?? null,
    onKeyDown,
    accept,
    dismiss,
    select: (index) => setSelectedIndex(index),
    refresh,
  };
}

function clampIndex(index: number, length: number): number {
  if (length <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(index, length - 1));
}

function textareaCaretRect(textarea: HTMLTextAreaElement, position: number): DOMRect | null {
  if (typeof document === "undefined") {
    return null;
  }
  const style = window.getComputedStyle(textarea);
  const textareaRect = textarea.getBoundingClientRect();
  const mirror = document.createElement("div");
  mirror.style.position = "fixed";
  mirror.style.visibility = "hidden";
  mirror.style.pointerEvents = "none";
  mirror.style.whiteSpace = "pre-wrap";
  mirror.style.overflowWrap = "break-word";
  mirror.style.wordBreak = style.wordBreak;
  mirror.style.boxSizing = style.boxSizing;
  mirror.style.left = `${textareaRect.left}px`;
  mirror.style.top = `${textareaRect.top}px`;
  mirror.style.width = `${textareaRect.width}px`;
  mirror.style.minHeight = `${textareaRect.height}px`;
  mirror.style.padding = style.padding;
  mirror.style.border = style.border;
  mirror.style.font = style.font;
  mirror.style.lineHeight = style.lineHeight;
  mirror.style.letterSpacing = style.letterSpacing;
  mirror.style.textTransform = style.textTransform;
  mirror.style.tabSize = style.tabSize;

  const before = textarea.value.slice(0, position);
  mirror.textContent = before.endsWith("\n") ? `${before} ` : before;
  const marker = document.createElement("span");
  marker.textContent = textarea.value.slice(position, position + 1) || "\u200b";
  mirror.append(marker);
  document.body.append(mirror);
  const markerRect = marker.getBoundingClientRect();
  mirror.remove();

  return new DOMRect(
    markerRect.left - textarea.scrollLeft,
    markerRect.top - textarea.scrollTop,
    markerRect.width,
    markerRect.height,
  );
}
