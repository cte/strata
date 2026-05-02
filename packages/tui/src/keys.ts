export type KeyId =
  | "enter"
  | "shift+enter"
  | "escape"
  | "tab"
  | "shift+tab"
  | "backspace"
  | "delete"
  | "up"
  | "down"
  | "left"
  | "right"
  | "home"
  | "end"
  | "pageup"
  | "pagedown"
  | "ctrl+a"
  | "ctrl+b"
  | "ctrl+c"
  | "ctrl+d"
  | "ctrl+e"
  | "ctrl+f"
  | "ctrl+k"
  | "ctrl+l"
  | "ctrl+n"
  | "ctrl+p"
  | "ctrl+r"
  | "ctrl+u"
  | "ctrl+w";

export type InputEvent =
  | { type: "key"; key: KeyId; raw: string }
  | { type: "text"; text: string; raw: string }
  | { type: "paste"; text: string; raw: string };

const PASTE_START = "\x1b[200~";
const PASTE_END = "\x1b[201~";

export class InputBuffer {
  private buffer = "";
  private pasting = false;
  private pasteContents = "";

  flush(): InputEvent[] {
    if (this.pasting || this.buffer === "") {
      return [];
    }
    if (this.buffer === "\x1b") {
      this.buffer = "";
      return [{ type: "key", key: "escape", raw: "\x1b" }];
    }
    return [];
  }

  push(chunk: string): InputEvent[] {
    this.buffer += chunk;
    const events: InputEvent[] = [];
    while (this.buffer.length > 0) {
      if (this.pasting) {
        const end = this.buffer.indexOf(PASTE_END);
        if (end === -1) {
          this.pasteContents += this.buffer;
          this.buffer = "";
          break;
        }
        this.pasteContents += this.buffer.slice(0, end);
        this.buffer = this.buffer.slice(end + PASTE_END.length);
        events.push({ type: "paste", text: this.pasteContents, raw: this.pasteContents });
        this.pasting = false;
        this.pasteContents = "";
        continue;
      }
      if (this.buffer.startsWith(PASTE_START)) {
        this.buffer = this.buffer.slice(PASTE_START.length);
        this.pasting = true;
        this.pasteContents = "";
        continue;
      }
      const consumed = parseOne(this.buffer);
      if (consumed === null) {
        break;
      }
      this.buffer = this.buffer.slice(consumed.length);
      events.push(toEvent(consumed));
    }
    return events;
  }
}

function parseOne(buffer: string): string | null {
  if (buffer.length === 0) {
    return null;
  }
  const first = buffer[0];
  if (first === "\x1b") {
    if (buffer.length === 1) {
      return null;
    }
    const second = buffer[1];
    if (second === "[" || second === "O") {
      const match = /^\x1b[[O][0-9;]*[A-Za-z~]/.exec(buffer);
      if (match) {
        return match[0];
      }
      return null;
    }
    return "\x1b";
  }
  return first ?? null;
}

function toEvent(raw: string): InputEvent {
  const key = parseKey(raw);
  if (key !== undefined) {
    return { type: "key", key, raw };
  }
  if (raw === "\r" || raw === "\n") {
    return { type: "key", key: "enter", raw };
  }
  return { type: "text", text: raw, raw };
}

function parseKey(raw: string): KeyId | undefined {
  switch (raw) {
    case "\r":
    case "\n":
      return "enter";
    case "\x1b":
      return "escape";
    case "\t":
      return "tab";
    case "\x7f":
    case "\b":
      return "backspace";
    case "\x01":
      return "ctrl+a";
    case "\x02":
      return "ctrl+b";
    case "\x03":
      return "ctrl+c";
    case "\x04":
      return "ctrl+d";
    case "\x05":
      return "ctrl+e";
    case "\x06":
      return "ctrl+f";
    case "\x0b":
      return "ctrl+k";
    case "\x0c":
      return "ctrl+l";
    case "\x0e":
      return "ctrl+n";
    case "\x10":
      return "ctrl+p";
    case "\x12":
      return "ctrl+r";
    case "\x15":
      return "ctrl+u";
    case "\x17":
      return "ctrl+w";
    case "\x1b[A":
    case "\x1bOA":
      return "up";
    case "\x1b[B":
    case "\x1bOB":
      return "down";
    case "\x1b[C":
    case "\x1bOC":
      return "right";
    case "\x1b[D":
    case "\x1bOD":
      return "left";
    case "\x1b[H":
    case "\x1bOH":
      return "home";
    case "\x1b[F":
    case "\x1bOF":
      return "end";
    case "\x1b[3~":
      return "delete";
    case "\x1b[5~":
      return "pageup";
    case "\x1b[6~":
      return "pagedown";
    case "\x1b[Z":
      return "shift+tab";
    case "\x1b[13;2u":
    case "\x1bOM":
      return "shift+enter";
  }
  return undefined;
}
