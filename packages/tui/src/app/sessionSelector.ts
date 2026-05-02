import type { SessionRecord } from "@cortex/core";
import { theme, truncateToWidth } from "../ansi.js";
import type { Component, Frame, RenderContext } from "../component.js";
import type { InputEvent } from "../keys.js";
import { centerModal } from "./chrome.js";

export class SessionSelector implements Component {
  active = false;
  selectedIndex = 0;
  sessions: SessionRecord[] = [];
  onSelect: (session: SessionRecord) => void = () => {};
  onCancel: () => void = () => {};

  open(
    sessions: SessionRecord[],
    onSelect: (session: SessionRecord) => void,
    onCancel: () => void,
  ): void {
    this.active = true;
    this.sessions = sessions;
    this.selectedIndex = 0;
    this.onSelect = onSelect;
    this.onCancel = onCancel;
  }

  close(): void {
    this.active = false;
    this.sessions = [];
    this.selectedIndex = 0;
  }

  render(ctx: RenderContext): Frame {
    const lines: string[] = [];
    if (this.sessions.length === 0) {
      lines.push(theme.muted("No sessions yet."));
    } else {
      for (let i = 0; i < Math.min(this.sessions.length, 12); i += 1) {
        const session = this.sessions[i];
        if (session === undefined) {
          continue;
        }
        const marker = i === this.selectedIndex ? theme.accent("›") : " ";
        const status = formatStatus(session);
        const title = session.title === "" ? session.kind : session.title;
        lines.push(
          `${marker} ${status} ${theme.muted(session.startedAt.slice(0, 19))} ${truncateToWidth(title, 50)}`,
        );
      }
    }
    lines.push("");
    lines.push(theme.muted("Up/Down to move · Enter to select · Esc to cancel"));
    return centerModal(lines, "sessions", ctx);
  }

  handleInput(event: InputEvent): "consumed" | "passthrough" {
    if (event.type !== "key") {
      return "consumed";
    }
    if (event.key === "up") {
      this.selectedIndex = Math.max(0, this.selectedIndex - 1);
      return "consumed";
    }
    if (event.key === "down") {
      this.selectedIndex = Math.min(Math.max(0, this.sessions.length - 1), this.selectedIndex + 1);
      return "consumed";
    }
    if (event.key === "enter") {
      const session = this.sessions[this.selectedIndex];
      if (session !== undefined) {
        this.onSelect(session);
      }
      return "consumed";
    }
    if (event.key === "escape") {
      this.onCancel();
      return "consumed";
    }
    return "consumed";
  }
}

function formatStatus(session: SessionRecord): string {
  switch (session.status) {
    case "completed":
      return theme.success("✓");
    case "failed":
      return theme.error("✗");
    case "interrupted":
      return theme.warning("·");
    case "running":
      return theme.accent("…");
    default:
      return theme.muted("?");
  }
}
