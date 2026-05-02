import type { SessionRecord } from "@cortex/core";
import { padToWidth, theme, truncateToWidth } from "../ansi.js";
import type { Component, Frame, RenderContext } from "../component.js";
import type { InputEvent } from "../keys.js";

export class SessionSelector implements Component {
  active = false;
  selectedIndex = 0;
  sessions: SessionRecord[] = [];
  onSelect: (session: SessionRecord) => void = () => {};
  onCancel: () => void = () => {};

  open(sessions: SessionRecord[], onSelect: (session: SessionRecord) => void, onCancel: () => void): void {
    this.sessions = sessions;
    this.selectedIndex = 0;
    this.onSelect = onSelect;
    this.onCancel = onCancel;
    this.active = true;
  }

  close(): void {
    this.active = false;
  }

  render(ctx: RenderContext): Frame {
    if (!this.active) {
      return { lines: [] };
    }
    const width = Math.min(ctx.width, 80);
    const lines: string[] = [];
    const horizontal = "─".repeat(Math.max(0, width - 2));
    lines.push(theme.accent(`┌─ sessions ${horizontal.slice(0, Math.max(0, width - 14))}┐`));
    if (this.sessions.length === 0) {
      lines.push(box(theme.muted("No sessions yet."), width));
    } else {
      for (let i = 0; i < Math.min(this.sessions.length, 12); i += 1) {
        const session = this.sessions[i];
        if (session === undefined) {
          continue;
        }
        const marker = i === this.selectedIndex ? theme.accent("›") : " ";
        const status = formatStatus(session);
        const title = session.title === "" ? session.kind : session.title;
        const line = `${marker} ${status} ${theme.muted(session.startedAt.slice(0, 19))} ${truncateToWidth(title, Math.max(0, width - 30))}`;
        lines.push(box(line, width));
      }
    }
    lines.push(box(theme.muted("Up/Down to move · Enter to view session id · Esc to cancel"), width));
    lines.push(theme.accent(`└${"─".repeat(width - 2)}┘`));
    return { lines: lines.map((line) => padToWidth(line, ctx.width)) };
  }

  handleInput(event: InputEvent): "consumed" | "passthrough" {
    if (!this.active || event.type !== "key") {
      return "passthrough";
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

function box(content: string, width: number): string {
  const inner = width - 4;
  return `${theme.accent("│ ")}${padToWidth(content, inner)}${theme.accent(" │")}`;
}
