import type { ModelProviderName } from "@strata/agent";
import { padToWidth, theme, truncateToWidth } from "../ansi.js";
import type { Component, Frame, RenderContext } from "../component.js";
import { Loader } from "../components.js";
import type { InputEvent } from "../keys.js";
import { renderInlinePicker } from "./chrome.js";

export interface ModelOption {
  id: string;
  description: string;
  provider: ModelProviderName;
}

export class ModelSelector implements Component {
  active = false;
  loading = false;
  errorMessage: string | undefined;
  selectedIndex = 0;
  models: ModelOption[] = [];
  currentProvider: ModelProviderName | undefined;
  currentModel: string | undefined;
  onSelect: (model: ModelOption) => void = () => {};
  onCancel: () => void = () => {};
  private readonly loader = new Loader("Loading models");

  open(
    currentProvider: ModelProviderName | undefined,
    currentModel: string | undefined,
    onSelect: (model: ModelOption) => void,
    onCancel: () => void,
  ): void {
    this.active = true;
    this.loading = true;
    this.errorMessage = undefined;
    this.models = [];
    this.selectedIndex = 0;
    this.currentProvider = currentProvider;
    this.currentModel = currentModel;
    this.onSelect = onSelect;
    this.onCancel = onCancel;
  }

  setModels(models: ModelOption[]): void {
    this.loading = false;
    this.errorMessage = undefined;
    this.models = models;
    const idx = models.findIndex(
      (model) => model.provider === this.currentProvider && model.id === this.currentModel,
    );
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
    this.currentProvider = undefined;
    this.currentModel = undefined;
  }

  render(ctx: RenderContext): Frame {
    if (!this.active) {
      return { lines: [] };
    }

    if (this.loading) {
      const loaderLine = this.loader.render(ctx).lines[0] ?? theme.muted("Loading models…");
      return { lines: [padToWidth(truncateToWidth(loaderLine, ctx.width), ctx.width)] };
    }

    if (this.errorMessage !== undefined) {
      const errorLine = theme.error(`Failed to load models: ${this.errorMessage}`);
      return { lines: [padToWidth(truncateToWidth(errorLine, ctx.width), ctx.width)] };
    }

    return renderInlinePicker(ctx, {
      active: true,
      selectedIndex: this.selectedIndex,
      items: this.models,
      header: "Select model — ↑/↓ select, Enter use, Esc cancel",
      emptyHint: "  (no chat-capable models returned)",
      renderRow: (model, isSelected) => {
        const name = isSelected ? theme.bold(theme.accent(model.id)) : theme.bold(model.id);
        const provider = theme.muted(`[${model.provider}]`);
        const current =
          model.provider === this.currentProvider && model.id === this.currentModel
            ? theme.success(" (current)")
            : "";
        const desc =
          model.description === "" ? "" : ` ${theme.muted(truncateToWidth(model.description, 50))}`;
        return `${name} ${provider}${current}${desc}`;
      },
    });
  }

  handleInput(event: InputEvent): "consumed" | "passthrough" {
    if (!this.active || event.type !== "key") {
      return "passthrough";
    }
    if (event.key === "escape") {
      this.onCancel();
      return "consumed";
    }
    if (this.loading || this.errorMessage !== undefined || this.models.length === 0) {
      return "consumed";
    }
    const last = Math.max(0, this.models.length - 1);
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
      const model = this.models[this.selectedIndex];
      if (model !== undefined) {
        this.onSelect(model);
      }
      return "consumed";
    }
    return "consumed";
  }
}
