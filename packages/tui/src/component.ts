import type { InputEvent } from "./keys.js";

export interface RenderContext {
  width: number;
  height: number;
}

export interface Frame {
  lines: string[];
  cursor?: { row: number; col: number };
}

export type InputResult = "consumed" | "passthrough";

export interface Component {
  render(ctx: RenderContext): Frame;
  handleInput?(event: InputEvent): InputResult;
}

export interface Focusable {
  focused: boolean;
}

export function emptyFrame(): Frame {
  return { lines: [] };
}

export function isFocusable(component: Component): component is Component & Focusable {
  return "focused" in component;
}
