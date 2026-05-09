import { Moon, Sun } from "lucide-react";
import type * as React from "react";
import { useTheme } from "@/lib/theme";

export function ThemeToggle(): React.ReactElement {
  const { theme, toggle } = useTheme();
  const isDark = theme === "dark";

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      aria-pressed={isDark}
      className="group inline-flex h-7 items-center gap-2 rounded-full border border-[var(--hairline)] bg-[var(--bg-elev)] px-2 text-[var(--fg-mute)] transition-colors duration-150 hover:border-[var(--hairline-strong)] hover:text-[var(--fg-dim)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]"
    >
      <span
        aria-hidden="true"
        className={`flex h-5 w-5 items-center justify-center rounded-full transition-colors duration-150 ${
          isDark ? "bg-transparent" : "bg-[var(--surface-2)] text-[var(--fg)]"
        }`}
      >
        <Sun size={11} strokeWidth={1.75} />
      </span>
      <span
        aria-hidden="true"
        className={`flex h-5 w-5 items-center justify-center rounded-full transition-colors duration-150 ${
          isDark ? "bg-[var(--surface-2)] text-[var(--fg)]" : "bg-transparent"
        }`}
      >
        <Moon size={11} strokeWidth={1.75} />
      </span>
    </button>
  );
}
