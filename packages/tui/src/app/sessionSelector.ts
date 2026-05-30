import type { DeleteSessionResult, SessionRecord } from "@strata/core";
import { sanitizeTerminalText, theme } from "../ansi.js";
import type { Component, Frame, RenderContext } from "../component.js";
import type { InputEvent } from "../keys.js";
import { renderInlinePicker } from "./chrome.js";

export class SessionSelector implements Component {
  active = false;
  selectedIndex = 0;
  sessions: SessionRecord[] = [];
  onSelect: (session: SessionRecord) => void = () => {};
  onCancel: () => void = () => {};
  onDeleteSession: (session: SessionRecord) => Promise<DeleteSessionResult> = async () => {
    throw new Error("Session deletion is not configured.");
  };
  private readonly onStateChange: () => void;
  private currentSessionId: string | undefined;
  private confirmingDeleteId: string | undefined;
  private statusMessage: { kind: "info" | "error"; text: string } | undefined;

  constructor(onStateChange: () => void = () => {}) {
    this.onStateChange = onStateChange;
  }

  open(
    sessions: SessionRecord[],
    onSelect: (session: SessionRecord) => void,
    onCancel: () => void,
    onDeleteSession?: (session: SessionRecord) => Promise<DeleteSessionResult>,
    currentSessionId?: string,
  ): void {
    this.active = true;
    this.sessions = sessions;
    this.selectedIndex = 0;
    this.onSelect = onSelect;
    this.onCancel = onCancel;
    this.onDeleteSession =
      onDeleteSession ??
      (async () => {
        throw new Error("Session deletion is not configured.");
      });
    this.currentSessionId = currentSessionId;
    this.confirmingDeleteId = undefined;
    this.statusMessage = undefined;
  }

  close(): void {
    this.active = false;
    this.sessions = [];
    this.selectedIndex = 0;
    this.confirmingDeleteId = undefined;
    this.statusMessage = undefined;
  }

  render(ctx: RenderContext): Frame {
    return renderInlinePicker(ctx, {
      active: this.active,
      selectedIndex: this.selectedIndex,
      items: this.sessions,
      header: this.header(),
      emptyHint: "  (no sessions yet)",
      renderRow: (session, isSelected) => {
        const status = formatStatus(session);
        const startedAt = theme.muted(formatSessionStartedAt(session.startedAt));
        const rawTitle = sessionDisplayTitle(session);
        const isConfirmingDelete = session.id === this.confirmingDeleteId;
        const title = isConfirmingDelete
          ? theme.error(rawTitle)
          : isSelected
            ? theme.accent(rawTitle)
            : rawTitle;
        return `${status} ${startedAt}  ${title}`;
      },
    });
  }

  handleInput(event: InputEvent): "consumed" | "passthrough" {
    if (!this.active || event.type !== "key") {
      return "passthrough";
    }
    const last = Math.max(0, this.sessions.length - 1);

    if (this.confirmingDeleteId !== undefined) {
      if (event.key === "enter") {
        const session = this.sessions.find((candidate) => candidate.id === this.confirmingDeleteId);
        this.confirmingDeleteId = undefined;
        if (session !== undefined) {
          void this.deleteSession(session);
        }
        return "consumed";
      }
      if (event.key === "escape") {
        this.confirmingDeleteId = undefined;
        this.statusMessage = undefined;
        return "consumed";
      }
      return "consumed";
    }

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
    if (event.key === "ctrl+d" || event.key === "ctrl+backspace") {
      this.startDeleteConfirmation();
      return "consumed";
    }
    if (event.key === "escape") {
      this.onCancel();
      return "consumed";
    }
    return "consumed";
  }

  private header(): string {
    if (this.confirmingDeleteId !== undefined) {
      return theme.error("Delete session? Enter confirm, Esc cancel");
    }
    if (this.statusMessage !== undefined) {
      const style = this.statusMessage.kind === "error" ? theme.error : theme.accent;
      return style(this.statusMessage.text);
    }
    return "Resume session — ↑/↓ select, Enter resume, Ctrl+D delete, Esc cancel";
  }

  private startDeleteConfirmation(): void {
    const session = this.sessions[this.selectedIndex];
    if (session === undefined) {
      return;
    }
    if (this.currentSessionId !== undefined && session.id === this.currentSessionId) {
      this.statusMessage = { kind: "error", text: "Cannot delete the currently active session" };
      return;
    }
    this.statusMessage = undefined;
    this.confirmingDeleteId = session.id;
  }

  private async deleteSession(session: SessionRecord): Promise<void> {
    try {
      const result = await this.onDeleteSession(session);
      this.sessions = this.sessions.filter((candidate) => candidate.id !== session.id);
      this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, this.sessions.length - 1));
      this.statusMessage = {
        kind: "info",
        text: result.traceMethod === "trash" ? "Session moved to trash" : "Session deleted",
      };
    } catch (error: unknown) {
      this.statusMessage = {
        kind: "error",
        text: `Failed to delete: ${error instanceof Error ? error.message : String(error)}`,
      };
    } finally {
      this.onStateChange();
    }
  }
}

export function sessionDisplayTitle(session: SessionRecord): string {
  const source = session.title === "" ? session.kind : session.title;
  const sanitized = sanitizeTerminalText(source).replace(/\s+/g, " ").trim();
  return sanitized === "" ? session.kind : sanitized;
}

function formatSessionStartedAt(startedAt: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(startedAt);
  return match === null ? startedAt : `${match[1]} ${match[2]}`;
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
