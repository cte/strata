import { readFileSync } from "node:fs";
import path from "node:path";
import { theme } from "../ansi.js";

/**
 * Read the @strata/tui package version at module load time. Pi reads its own
 * package.json the same way (`config.ts:370`); we mirror that. If the file
 * isn't readable for some reason (e.g. a packaged binary that doesn't ship
 * package.json next to the source), fall back to "0.0.0" so launch never
 * crashes on a missing version string.
 */
function readVersion(): string {
  try {
    const pkgPath = path.resolve(import.meta.dir, "..", "..", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { version?: unknown };
    return typeof pkg.version === "string" && pkg.version !== "" ? pkg.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export const VERSION = readVersion();

/**
 * Build the pi-shaped startup header lines.
 *
 *   strata v0.1.0
 *   escape interrupt · ctrl+c/ctrl+d clear/exit · / commands · @ files · /help more
 *   Type /help for the full keymap and command list.
 *
 * Returns already-styled strings — the transcript renderer prints them with a
 * single leading space, no further styling applied.
 */
export function buildStartupHeader(): string[] {
  const logo = `${theme.bold(theme.accent("strata"))}${theme.dim(` v${VERSION}`)}`;
  const sep = theme.muted(" · ");
  const hints = [
    `${theme.muted("escape")} interrupt`,
    `${theme.muted("ctrl+c/ctrl+d")} clear/exit`,
    `${theme.muted("/")} commands`,
    `${theme.muted("@")} files`,
    `${theme.muted("/help")} more`,
  ].join(sep);
  const onboarding = theme.dim("Type /help for the full keymap and command list.");
  // Leading blank line mirrors pi's `Spacer(1)` above its `headerContainer`
  // (`interactive-mode.ts:616`) so the logo doesn't butt up against the top
  // of the viewport / prior shell prompt.
  return ["", logo, hints, onboarding];
}

/**
 * Build the lines for `/help`. Printed inline into the transcript scrollback
 * so the user can scroll the terminal to read it (pi has no separate help
 * modal — the same content lives in its expanded startup header).
 */
export function buildHelpNotice(commands: { name: string; description: string }[]): string[] {
  const section = (title: string) => theme.bold(theme.accent(title));
  const key = (label: string) => theme.muted(label);
  const lines: string[] = [];
  lines.push(`${theme.bold(theme.accent("strata"))}${theme.dim(` v${VERSION}`)}`);
  lines.push("");
  lines.push(section("Editor"));
  lines.push(`  ${key("Enter".padEnd(14))}submit`);
  lines.push(`  ${key("Shift+Enter".padEnd(14))}newline`);
  lines.push(`  ${key("Tab".padEnd(14))}autocomplete /commands and @files`);
  lines.push(`  ${key("Shift+Tab".padEnd(14))}cycle thinking level`);
  lines.push(`  ${key("Up/Down".padEnd(14))}history`);
  lines.push(`  ${key("Alt+Enter".padEnd(14))}queue follow-up message`);
  lines.push(`  ${key("Ctrl+L".padEnd(14))}redraw`);
  lines.push(`  ${key("Ctrl+C".padEnd(14))}interrupt run / clear input / exit`);
  lines.push(`  ${key("Ctrl+D".padEnd(14))}exit (when input is empty)`);
  lines.push(`  ${key("Esc".padEnd(14))}cancel completion / dismiss overlay / interrupt run`);
  lines.push(`  ${key("Esc Esc".padEnd(14))}open the resume picker`);
  lines.push("");
  lines.push(section("Slash commands"));
  if (commands.length === 0) {
    lines.push(theme.muted("  (none registered)"));
  } else {
    const nameWidth = Math.min(
      18,
      commands.reduce((max, cmd) => Math.max(max, cmd.name.length + 1), 0),
    );
    for (const cmd of commands) {
      lines.push(`  ${key(`/${cmd.name}`.padEnd(nameWidth))}${cmd.description}`);
    }
  }
  return lines;
}
