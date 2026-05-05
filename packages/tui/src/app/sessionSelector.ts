import type { SessionRecord } from "@cortex/core";
import { theme } from "../ansi.js";
import type { Component, Frame, RenderContext } from "../component.js";
import type { InputEvent } from "../keys.js";
import { renderInlinePicker } from "./chrome.js";

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
    return renderInlinePicker(ctx, {
      active: this.active,
      selectedIndex: this.selectedIndex,
      items: this.sessions,
      header: "Resume session — ↑/↓ select, Enter resume, Esc cancel",
      emptyHint: "  (no sessions yet)",
      renderRow: (session, isSelected) => {
        const status = formatStatus(session);
        const date = theme.muted(session.startedAt.slice(0, 10));
        const rawTitle = session.title === "" ? session.kind : session.title;
        const title = isSelected ? theme.accent(rawTitle) : rawTitle;
        return `${status} ${date}  ${title}`;
      },
    });
  }

  handleInput(event: InputEvent): "consumed" | "passthrough" {
    if (!this.active || event.type !== "key") {
      return "passthrough";
    }
    const last = Math.max(0, this.sessions.length - 1);
    if (event.key === "up") {
      this.selectedIndex = Math.max(0, this.selectedIndex - 1);
      return "consumed";
    }
    if (event.key === "down") {
      this.selectedIndex = Math.min(last, this.selectedIndex + 1);
      return "consumed";
    }
    if (event.key === "pageup") {
      this.selectedIndex = Math.max(0, this.selectedIndex - 10);
      return "consumed";
    }
    if (event.key === "pagedown") {
      this.selectedIndex = Math.min(last, this.selectedIndex + 10);
      return "consumed";
    }
    if (event.key === "home") {
      this.selectedIndex = 0;
      return "consumed";
    }
    if (event.key === "end") {
      this.selectedIndex = last;
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
