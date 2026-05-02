import {
  ChatGptLoginCancelled,
  clearChatGptCredentials,
  loginChatGpt,
  setChatGptCredentials,
} from "@cortex/agent";
import { theme, truncateToWidth } from "../ansi.js";
import type { Component, Frame, RenderContext } from "../component.js";
import type { InputEvent } from "../keys.js";
import { centerModal } from "./chrome.js";

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
  private rejectManual: ((error: Error) => void) | undefined;
  private controller: AbortController | undefined;
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
    this.controller = new AbortController();
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
      signal: this.controller.signal,
    })
      .then(async (credentials) => {
        await setChatGptCredentials(credentials);
        this.close();
        onResult({ ok: true, message: "Logged in to openai-codex." });
      })
      .catch((error: unknown) => {
        this.close();
        if (error instanceof ChatGptLoginCancelled) {
          onResult({ ok: false, message: "Login cancelled." });
          return;
        }
        onResult({ ok: false, message: error instanceof Error ? error.message : String(error) });
      });
  }

  close(): void {
    this.active = false;
    this.controller?.abort();
    this.controller = undefined;
    this.rejectManual?.(new ChatGptLoginCancelled());
    this.resolveManual = undefined;
    this.rejectManual = undefined;
    this.onChange();
  }

  render(ctx: RenderContext): Frame {
    const lines: string[] = [];
    lines.push(theme.bold("Sign in to ChatGPT"));
    lines.push("");
    if (this.url !== "") {
      lines.push(theme.accent(this.url));
      lines.push("");
    }
    lines.push(theme.muted(this.status));
    lines.push("");
    lines.push(`${theme.muted("paste:")} ${this.renderInput(60)}`);
    lines.push(theme.muted("Enter to submit · Esc to cancel"));
    return centerModal(lines, "login", ctx);
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
        this.close();
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
    return new Promise((resolve, reject) => {
      this.resolveManual = (value) => {
        this.resolveManual = undefined;
        this.rejectManual = undefined;
        resolve(value);
      };
      this.rejectManual = (error) => {
        this.resolveManual = undefined;
        this.rejectManual = undefined;
        reject(error);
      };
    });
  }
}

export async function logoutChatGpt(): Promise<void> {
  await clearChatGptCredentials();
}
