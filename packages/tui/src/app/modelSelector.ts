import { theme, truncateToWidth } from "../ansi.js";
import type { Component, Frame, RenderContext } from "../component.js";
import { Loader } from "../components.js";
import type { InputEvent } from "../keys.js";
import { centerModal } from "./chrome.js";

export interface ModelOption {
  id: string;
  description: string;
}

export class ModelSelector implements Component {
  active = false;
  loading = false;
  errorMessage: string | undefined;
  selectedIndex = 0;
  models: ModelOption[] = [];
  currentModel: string | undefined;
  onSelect: (model: ModelOption) => void = () => {};
  onCancel: () => void = () => {};
  private readonly loader = new Loader("Loading models from OpenAI");

  open(
    currentModel: string | undefined,
    onSelect: (model: ModelOption) => void,
    onCancel: () => void,
  ): void {
    this.active = true;
    this.loading = true;
    this.errorMessage = undefined;
    this.models = [];
    this.selectedIndex = 0;
    this.currentModel = currentModel;
    this.onSelect = onSelect;
    this.onCancel = onCancel;
  }

  setModels(models: ModelOption[]): void {
    this.loading = false;
    this.errorMessage = undefined;
    this.models = models;
    const idx = models.findIndex((m) => m.id === this.currentModel);
    this.selectedIndex = idx >= 0 ? idx : 0;
  }

  setError(message: string): void {
    this.loading = false;
    this.errorMessage = message;
    this.models = [];
    this.selectedIndex = 0;
  }

  close(): void {
    this.active = false;
    this.loading = false;
    this.errorMessage = undefined;
    this.models = [];
    this.selectedIndex = 0;
  }

  render(ctx: RenderContext): Frame {
    const lines: string[] = [];
    if (this.loading) {
      lines.push(this.loader.render(ctx).lines[0] ?? theme.muted("Loading models from OpenAI…"));
    } else if (this.errorMessage !== undefined) {
      lines.push(theme.error(`Failed to load models: ${this.errorMessage}`));
    } else if (this.models.length === 0) {
      lines.push(theme.muted("No chat-capable models returned."));
    } else {
      for (let i = 0; i < this.models.length; i += 1) {
        const model = this.models[i];
        if (model === undefined) {
          continue;
        }
        const marker = i === this.selectedIndex ? theme.accent("›") : " ";
        const label =
          i === this.selectedIndex ? theme.bold(theme.accent(model.id)) : theme.bold(model.id);
        const current = model.id === this.currentModel ? theme.success(" (current)") : "";
        const desc =
          model.description === "" ? "" : ` ${theme.muted(truncateToWidth(model.description, 40))}`;
        lines.push(`${marker} ${label}${current}${desc}`);
      }
    }
    lines.push("");
    lines.push(theme.muted("Up/Down to move · Enter to select · Esc to cancel"));
    return centerModal(lines, "model", ctx);
  }

  handleInput(event: InputEvent): "consumed" | "passthrough" {
    if (event.type !== "key") {
      return "consumed";
    }
    if (event.key === "escape") {
      this.onCancel();
      return "consumed";
    }
    if (this.loading || this.errorMessage !== undefined || this.models.length === 0) {
      return "consumed";
    }
    if (event.key === "up") {
      this.selectedIndex = Math.max(0, this.selectedIndex - 1);
      return "consumed";
    }
    if (event.key === "down") {
      this.selectedIndex = Math.min(Math.max(0, this.models.length - 1), this.selectedIndex + 1);
      return "consumed";
    }
    if (event.key === "enter") {
      const model = this.models[this.selectedIndex];
      if (model !== undefined) {
        this.onSelect(model);
      }
      return "consumed";
    }
    return "consumed";
  }
}
