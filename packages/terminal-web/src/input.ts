export type TerminalDataListener = (data: string) => void;

export class TerminalInputController {
  private readonly dataListeners = new Set<TerminalDataListener>();
  private element: HTMLDivElement | null = null;
  private composition = false;
  private bracketedPaste = false;
  private readonly keydownHandler = (event: KeyboardEvent) => this.handleKeydown(event);
  private readonly beforeInputHandler = (event: InputEvent) => this.handleBeforeInput(event);
  private readonly pasteHandler = (event: ClipboardEvent) => this.handlePaste(event);
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
  }

  detach(): void {
    if (this.element === null) return;
    this.element.removeEventListener("keydown", this.keydownHandler);
    this.element.removeEventListener("beforeinput", this.beforeInputHandler);
    this.element.removeEventListener("paste", this.pasteHandler);
    this.element.removeEventListener("compositionstart", this.compositionStartHandler);
    this.element.removeEventListener("compositionend", this.compositionEndHandler);
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
    const sequence = keySequence(event);
    if (sequence === null) return;
    event.preventDefault();
    this.emitData(sequence);
  }
}

export function pastePayload(text: string, bracketedPaste: boolean): string {
  return bracketedPaste ? `\x1b[200~${text}\x1b[201~` : text;
}

export function keySequence(event: KeyboardEvent): string | null {
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
      return "\x1b[A";
    case "ArrowDown":
      return "\x1b[B";
    case "ArrowRight":
      return "\x1b[C";
    case "ArrowLeft":
      return "\x1b[D";
    case "Home":
      return "\x1b[H";
    case "End":
      return "\x1b[F";
    case "Delete":
      return "\x1b[3~";
    default:
      return null;
  }
}
