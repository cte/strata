import { useEffect, useState } from "react";

export type Theme = "dark" | "light";

const STORAGE_KEY = "strata-theme";

function readTheme(): Theme {
  if (typeof document === "undefined") {
    return "dark";
  }
  const attr = document.documentElement.dataset.theme;
  return attr === "light" ? "light" : "dark";
}

function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // ignore quota / privacy-mode failures
  }
}

export function useTheme(): { theme: Theme; toggle: () => void; set: (theme: Theme) => void } {
  const [theme, setTheme] = useState<Theme>(() => readTheme());

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  return {
    theme,
    set: setTheme,
    toggle: () => setTheme((current) => (current === "dark" ? "light" : "dark")),
  };
}
