export type TerminalDataListener = (data: string) => void;

export interface TerminalInputModes {
  applicationCursor: boolean;
  mouseTracking: boolean;
  sgrMouse: boolean;
}

export class TerminalInputController {
  private readonly dataListeners = new Set<TerminalDataListener>();
  private element: HTMLDivElement | null = null;
  private composition = false;
  private bracketedPaste = false;
  private modes: TerminalInputModes = {
    applicationCursor: false,
    mouseTracking: false,
    sgrMouse: false,
  };
  private readonly keydownHandler = (event: KeyboardEvent) => this.handleKeydown(event);
  private readonly beforeInputHandler = (event: InputEvent) => this.handleBeforeInput(event);
  private readonly pasteHandler = (event: ClipboardEvent) => this.handlePaste(event);
  private readonly mouseDownHandler = (event: MouseEvent) => this.handleMouse("down", event);
  private readonly mouseUpHandler = (event: MouseEvent) => this.handleMouse("up", event);
  private readonly mouseMoveHandler = (event: MouseEvent) => this.handleMouse("move", event);
  private readonly wheelHandler = (event: WheelEvent) => this.handleWheel(event);
  private readonly compositionStartHandler = () => {
    this.composition = true;
  };
  private readonly compositionEndHandler = (event: CompositionEvent) => {
    this.composition = false;
    if (event.data.length > 0) this.emitData(event.data);
  };

  attach(element: HTMLDivElement): void {
    this.detach();
    this.element = element;
    element.addEventListener("keydown", this.keydownHandler);
    element.addEventListener("beforeinput", this.beforeInputHandler);
    element.addEventListener("paste", this.pasteHandler);
    element.addEventListener("compositionstart", this.compositionStartHandler);
    element.addEventListener("compositionend", this.compositionEndHandler);
    element.addEventListener("mousedown", this.mouseDownHandler);
    element.addEventListener("mouseup", this.mouseUpHandler);
    element.addEventListener("mousemove", this.mouseMoveHandler);
    element.addEventListener("wheel", this.wheelHandler, { passive: false });
  }

  detach(): void {
    if (this.element === null) return;
    this.element.removeEventListener("keydown", this.keydownHandler);
    this.element.removeEventListener("beforeinput", this.beforeInputHandler);
    this.element.removeEventListener("paste", this.pasteHandler);
    this.element.removeEventListener("compositionstart", this.compositionStartHandler);
    this.element.removeEventListener("compositionend", this.compositionEndHandler);
    this.element.removeEventListener("mousedown", this.mouseDownHandler);
    this.element.removeEventListener("mouseup", this.mouseUpHandler);
    this.element.removeEventListener("mousemove", this.mouseMoveHandler);
    this.element.removeEventListener("wheel", this.wheelHandler);
    this.element = null;
    this.composition = false;
  }

  dispose(): void {
    this.detach();
    this.dataListeners.clear();
  }

  onData(listener: TerminalDataListener): { dispose: () => void } {
    this.dataListeners.add(listener);
    return { dispose: () => this.dataListeners.delete(listener) };
  }

  setBracketedPaste(enabled: boolean): void {
    this.bracketedPaste = enabled;
  }

  setModes(modes: TerminalInputModes): void {
    this.modes = { ...modes };
  }

  private emitData(data: string): void {
    for (const listener of this.dataListeners) listener(data);
  }

  private handleBeforeInput(event: InputEvent): void {
    if (this.composition) return;
    if (
      event.inputType === "insertText" &&
      typeof event.data === "string" &&
      event.data.length > 0
    ) {
      event.preventDefault();
      this.emitData(event.data);
    }
  }

  private handlePaste(event: ClipboardEvent): void {
    event.preventDefault();
    const text = event.clipboardData?.getData("text/plain") ?? "";
    if (text.length > 0) this.emitData(pastePayload(text, this.bracketedPaste));
  }

  private handleKeydown(event: KeyboardEvent): void {
    if (isCopyShortcut(event) && hasDocumentSelection(this.element)) return;
    const sequence = keySequence(event, this.modes);
    if (sequence === null) return;
    event.preventDefault();
    this.emitData(sequence);
  }

  private handleMouse(kind: "down" | "up" | "move", event: MouseEvent): void {
    if (!this.modes.mouseTracking || this.element === null) return;
    if (kind === "move" && event.buttons === 0) return;
    if (!this.modes.sgrMouse) return;

    event.preventDefault();
    this.element.focus();
    const position = mouseCellPosition(this.element, event);
    const button = mouseButtonCode(kind, event);
    const suffix = kind === "up" ? "m" : "M";
    this.emitData(sgrMouseSequence(button, position.col, position.row, suffix));
  }

  private handleWheel(event: WheelEvent): void {
    if (!this.modes.mouseTracking || !this.modes.sgrMouse || this.element === null) return;
    event.preventDefault();
    const position = mouseCellPosition(this.element, event);
    this.emitData(sgrMouseSequence(event.deltaY < 0 ? 64 : 65, position.col, position.row, "M"));
  }
}

export function pastePayload(text: string, bracketedPaste: boolean): string {
  return bracketedPaste ? `\x1b[200~${text}\x1b[201~` : text;
}

export function keySequence(
  event: KeyboardEvent,
  modes: Partial<Pick<TerminalInputModes, "applicationCursor">> = {},
): string | null {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "v") return null;
  if (event.key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey) {
    return event.key;
  }
  if (event.ctrlKey && !event.altKey && event.key.length === 1) {
    const lower = event.key.toLowerCase();
    const code = lower.charCodeAt(0);
    if (code >= 97 && code <= 122) return String.fromCharCode(code - 96);
  }
  switch (event.key) {
    case "Enter":
      return "\r";
    case "Backspace":
      return "\x7f";
    case "Tab":
      return event.shiftKey ? "\x1b[Z" : "\t";
    case "Escape":
      return "\x1b";
    case "ArrowUp":
      return modes.applicationCursor === true ? "\x1bOA" : "\x1b[A";
    case "ArrowDown":
      return modes.applicationCursor === true ? "\x1bOB" : "\x1b[B";
    case "ArrowRight":
      return modes.applicationCursor === true ? "\x1bOC" : "\x1b[C";
    case "ArrowLeft":
      return modes.applicationCursor === true ? "\x1bOD" : "\x1b[D";
    case "Insert":
      return "\x1b[2~";
    case "PageUp":
      return "\x1b[5~";
    case "PageDown":
      return "\x1b[6~";
    case "Home":
      return "\x1b[H";
    case "End":
      return "\x1b[F";
    case "Delete":
      return "\x1b[3~";
    case "F1":
      return "\x1bOP";
    case "F2":
      return "\x1bOQ";
    case "F3":
      return "\x1bOR";
    case "F4":
      return "\x1bOS";
    case "F5":
      return "\x1b[15~";
    case "F6":
      return "\x1b[17~";
    case "F7":
      return "\x1b[18~";
    case "F8":
      return "\x1b[19~";
    case "F9":
      return "\x1b[20~";
    case "F10":
      return "\x1b[21~";
    case "F11":
      return "\x1b[23~";
    case "F12":
      return "\x1b[24~";
    default:
      return null;
  }
}

export function sgrMouseSequence(
  button: number,
  col: number,
  row: number,
  suffix: "M" | "m",
): string {
  return `\x1b[<${button};${Math.max(1, col)};${Math.max(1, row)}${suffix}`;
}

function mouseButtonCode(kind: "down" | "up" | "move", event: MouseEvent): number {
  if (kind === "up") return 3;
  const base = event.button === 1 ? 1 : event.button === 2 ? 2 : 0;
  return kind === "move" ? base + 32 : base;
}

function mouseCellPosition(
  element: HTMLElement,
  event: Pick<MouseEvent, "clientX" | "clientY">,
): { col: number; row: number } {
  const rect = element.getBoundingClientRect();
  const computed = getComputedStyle(element);
  const fontSize = Number.parseFloat(computed.fontSize) || 13;
  const lineHeight = Number.parseFloat(computed.lineHeight) || fontSize * 1.35;
  const cellWidth = fontSize * 0.62;
  const leftPadding = Number.parseFloat(computed.paddingLeft) || 0;
  const topPadding = Number.parseFloat(computed.paddingTop) || 0;

  return {
    col: Math.floor((event.clientX - rect.left - leftPadding + element.scrollLeft) / cellWidth) + 1,
    row: Math.floor((event.clientY - rect.top - topPadding + element.scrollTop) / lineHeight) + 1,
  };
}

function isCopyShortcut(event: KeyboardEvent): boolean {
  return (event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "c";
}

export function hasDocumentSelection(root: Node | null): boolean {
  const selection = globalThis.getSelection?.();
  if (selection === undefined || selection === null || selection.isCollapsed) return false;
  if (root === null) return false;
  return (
    isSelectionNodeInside(root, selection.anchorNode) &&
    isSelectionNodeInside(root, selection.focusNode)
  );
}

function isSelectionNodeInside(root: Node, node: Node | null): boolean {
  return node !== null && (node === root || root.contains(node));
}
