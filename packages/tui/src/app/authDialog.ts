import { clearChatGptCredentials, loginChatGpt, setChatGptCredentials } from "@cortex/agent";
import { padToWidth, theme, truncateToWidth, wrapText } from "../ansi.js";
import type { Component, Frame, RenderContext } from "../component.js";
import type { InputEvent } from "../keys.js";

export interface AuthDialogResult {
  ok: boolean;
  message: string;
}

export class AuthDialog implements Component {
  active = false;
  focused = true;
  private status = "Starting login flow…";
  private url = "";
  private input = "";
  private cursor = 0;
  private resolveManual: ((value: string) => void) | undefined;
  private cancel: (() => void) | undefined;
  private onChange: () => void;

  constructor(onChange: () => void) {
    this.onChange = onChange;
  }

  start(onResult: (result: AuthDialogResult) => void): void {
    this.active = true;
    this.status = "Starting login flow…";
    this.url = "";
    this.input = "";
    this.cursor = 0;
    let cancelled = false;
    this.cancel = () => {
      cancelled = true;
      this.resolveManual?.("");
    };
    void loginChatGpt({
      onAuth: (info) => {
        this.url = info.url;
        this.status = "Open the URL in a browser, then paste the redirect.";
        this.onChange();
      },
      onPrompt: async (prompt: string) => {
        this.status = prompt;
        this.onChange();
        return await this.waitForManual();
      },
      onManualCodeInput: async () => {
        return await this.waitForManual();
      },
      onProgress: (message) => {
        this.status = message;
        this.onChange();
      },
    })
      .then(async (credentials) => {
        if (cancelled) {
          this.close();
          onResult({ ok: false, message: "Login cancelled." });
          return;
        }
        await setChatGptCredentials(credentials);
        this.close();
        onResult({ ok: true, message: "Logged in to openai-codex." });
      })
      .catch((error: unknown) => {
        this.close();
        if (cancelled) {
          onResult({ ok: false, message: "Login cancelled." });
          return;
        }
        onResult({ ok: false, message: error instanceof Error ? error.message : String(error) });
      });
  }

  close(): void {
    this.active = false;
    this.resolveManual?.("");
    this.cancel = undefined;
    this.onChange();
  }

  render(ctx: RenderContext): Frame {
    if (!this.active) {
      return { lines: [] };
    }
    const width = Math.min(ctx.width, 70);
    const inner = width - 4;
    const lines: string[] = [];
    lines.push(theme.accent(`┌─ login ─${"─".repeat(Math.max(0, width - 11))}┐`));
    lines.push(box(`${theme.bold("Sign in to ChatGPT")}`, width));
    lines.push(box("", width));
    if (this.url !== "") {
      for (const segment of wrapText(theme.accent(this.url), inner)) {
        lines.push(box(segment, width));
      }
      lines.push(box("", width));
    }
    for (const segment of wrapText(theme.muted(this.status), inner)) {
      lines.push(box(segment, width));
    }
    lines.push(box("", width));
    lines.push(box(`${theme.muted("paste:")} ${this.renderInput(inner - 7)}`, width));
    lines.push(box(theme.muted("Enter to submit · Esc to cancel"), width));
    lines.push(theme.accent(`└${"─".repeat(width - 2)}┘`));
    return { lines: lines.map((line) => padToWidth(line, ctx.width)) };
  }

  handleInput(event: InputEvent): "consumed" | "passthrough" {
    if (!this.active) {
      return "passthrough";
    }
    if (event.type === "paste") {
      this.input = this.input.slice(0, this.cursor) + event.text + this.input.slice(this.cursor);
      this.cursor += event.text.length;
      this.onChange();
      return "consumed";
    }
    if (event.type === "text") {
      this.input = this.input.slice(0, this.cursor) + event.text + this.input.slice(this.cursor);
      this.cursor += event.text.length;
      this.onChange();
      return "consumed";
    }
    if (event.type !== "key") {
      return "consumed";
    }
    switch (event.key) {
      case "enter":
        this.resolveManual?.(this.input);
        this.input = "";
        this.cursor = 0;
        this.onChange();
        return "consumed";
      case "escape":
        this.cancel?.();
        return "consumed";
      case "backspace":
        if (this.cursor > 0) {
          this.input = this.input.slice(0, this.cursor - 1) + this.input.slice(this.cursor);
          this.cursor -= 1;
          this.onChange();
        }
        return "consumed";
      case "left":
        this.cursor = Math.max(0, this.cursor - 1);
        return "consumed";
      case "right":
        this.cursor = Math.min(this.input.length, this.cursor + 1);
        return "consumed";
      case "ctrl+u":
        this.input = "";
        this.cursor = 0;
        this.onChange();
        return "consumed";
      default:
        return "consumed";
    }
  }

  private renderInput(width: number): string {
    if (this.input === "") {
      return theme.muted("redirect URL or code");
    }
    return truncateToWidth(this.input, Math.max(1, width));
  }

  private waitForManual(): Promise<string> {
    return new Promise((resolve) => {
      this.resolveManual = (value) => {
        this.resolveManual = undefined;
        resolve(value);
      };
    });
  }
}

export async function logoutChatGpt(): Promise<void> {
  await clearChatGptCredentials();
}

function box(content: string, width: number): string {
  const inner = width - 4;
  return `${theme.accent("│ ")}${padToWidth(content, inner)}${theme.accent(" │")}`;
}
