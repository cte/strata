import * as React from "react";

export interface LocalStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface UseLocalStorageStateOptions<T> {
  deserialize?: (value: string) => T;
  serialize?: (value: T) => string;
  storage?: LocalStorageLike;
}

export function useLocalStorageState<T>(
  key: string,
  defaultValue: T | (() => T),
  options: UseLocalStorageStateOptions<T> = {},
): [T, React.Dispatch<React.SetStateAction<T>>] {
  const storage = options.storage ?? browserLocalStorage();
  const deserialize = options.deserialize ?? defaultDeserialize<T>;
  const serialize = options.serialize ?? defaultSerialize<T>;

  const [value, setValue] = React.useState<T>(() =>
    readLocalStorageValue(key, defaultValue, storage, deserialize),
  );

  const setStoredValue = React.useCallback<React.Dispatch<React.SetStateAction<T>>>(
    (nextValue) => {
      setValue((currentValue) => {
        const resolvedValue =
          typeof nextValue === "function"
            ? (nextValue as (currentValue: T) => T)(currentValue)
            : nextValue;
        try {
          storage?.setItem(key, serialize(resolvedValue));
        } catch {
          // Keep React state usable even when browser storage is unavailable.
        }
        return resolvedValue;
      });
    },
    [key, serialize, storage],
  );

  return [value, setStoredValue];
}

function readLocalStorageValue<T>(
  key: string,
  defaultValue: T | (() => T),
  storage: LocalStorageLike | undefined,
  deserialize: (value: string) => T,
): T {
  const fallback = resolveDefaultValue(defaultValue);
  if (storage === undefined) {
    return fallback;
  }

  try {
    const rawValue = storage.getItem(key);
    return rawValue === null ? fallback : deserialize(rawValue);
  } catch {
    return fallback;
  }
}

function resolveDefaultValue<T>(defaultValue: T | (() => T)): T {
  return typeof defaultValue === "function" ? (defaultValue as () => T)() : defaultValue;
}

function defaultDeserialize<T>(value: string): T {
  return JSON.parse(value) as T;
}

function defaultSerialize<T>(value: T): string {
  return JSON.stringify(value) ?? "null";
}

function browserLocalStorage(): LocalStorageLike | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }
  return window.localStorage;
}
