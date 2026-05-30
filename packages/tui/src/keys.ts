/**
 * Keyboard input handling — ported from pi-mono (packages/tui/src/keys.ts),
 * MIT-licensed. Supports legacy terminal sequences and the Kitty keyboard
 * protocol. See https://sw.kovidgoyal.net/kitty/keyboard-protocol/.
 *
 * Strata preserves a narrow `KeyId` union covering only the keys strata's
 * components actually handle; pi's `parseKey` returns arbitrary key id
 * strings, which we filter into the union via `parseRecognizedKey`.
 */

export type KeyId =
  | "enter"
  | "shift+enter"
  | "alt+enter"
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
  | "ctrl+backspace"
  | "ctrl+k"
  | "ctrl+l"
  | "ctrl+n"
  | "ctrl+p"
  | "ctrl+r"
  | "ctrl+u"
  | "ctrl+w"
  | "ctrl+z";

export type InputEvent =
  | { type: "key"; key: KeyId; raw: string }
  | { type: "text"; text: string; raw: string }
  | { type: "paste"; text: string; raw: string };

const RECOGNIZED_KEY_IDS = new Set<string>([
  "enter",
  "shift+enter",
  "alt+enter",
  "escape",
  "tab",
  "shift+tab",
  "backspace",
  "delete",
  "up",
  "down",
  "left",
  "right",
  "home",
  "end",
  "pageUp",
  "pageDown",
  "ctrl+a",
  "ctrl+b",
  "ctrl+c",
  "ctrl+d",
  "ctrl+e",
  "ctrl+f",
  "ctrl+backspace",
  "ctrl+k",
  "ctrl+l",
  "ctrl+n",
  "ctrl+p",
  "ctrl+r",
  "ctrl+u",
  "ctrl+w",
  "ctrl+z",
]);

// Pi uses "pageUp"/"pageDown"; strata's KeyId uses "pageup"/"pagedown".
function normalizeRecognizedKey(id: string): KeyId | undefined {
  if (id === "pageUp") return "pageup";
  if (id === "pageDown") return "pagedown";
  return RECOGNIZED_KEY_IDS.has(id) ? (id as KeyId) : undefined;
}

// =============================================================================
// Global Kitty Protocol State
// =============================================================================

let _kittyProtocolActive = false;

export function setKittyProtocolActive(active: boolean): void {
  _kittyProtocolActive = active;
}

export function isKittyProtocolActive(): boolean {
  return _kittyProtocolActive;
}

// =============================================================================
// Constants
// =============================================================================

const SYMBOL_KEYS = new Set([
  "`",
  "-",
  "=",
  "[",
  "]",
  "\\",
  ";",
  "'",
  ",",
  ".",
  "/",
  "!",
  "@",
  "#",
  "$",
  "%",
  "^",
  "&",
  "*",
  "(",
  ")",
  "_",
  "+",
  "|",
  "~",
  "{",
  "}",
  ":",
  "<",
  ">",
  "?",
]);

const MODIFIERS = {
  shift: 1,
  alt: 2,
  ctrl: 4,
  super: 8,
} as const;

const LOCK_MASK = 64 + 128;

const CODEPOINTS = {
  escape: 27,
  tab: 9,
  enter: 13,
  space: 32,
  backspace: 127,
  kpEnter: 57414,
} as const;

const ARROW_CODEPOINTS = {
  up: -1,
  down: -2,
  right: -3,
  left: -4,
} as const;

const FUNCTIONAL_CODEPOINTS = {
  delete: -10,
  insert: -11,
  pageUp: -12,
  pageDown: -13,
  home: -14,
  end: -15,
} as const;

const KITTY_FUNCTIONAL_KEY_EQUIVALENTS = new Map<number, number>([
  [57399, 48],
  [57400, 49],
  [57401, 50],
  [57402, 51],
  [57403, 52],
  [57404, 53],
  [57405, 54],
  [57406, 55],
  [57407, 56],
  [57408, 57],
  [57409, 46],
  [57410, 47],
  [57411, 42],
  [57412, 45],
  [57413, 43],
  [57415, 61],
  [57416, 44],
  [57417, ARROW_CODEPOINTS.left],
  [57418, ARROW_CODEPOINTS.right],
  [57419, ARROW_CODEPOINTS.up],
  [57420, ARROW_CODEPOINTS.down],
  [57421, FUNCTIONAL_CODEPOINTS.pageUp],
  [57422, FUNCTIONAL_CODEPOINTS.pageDown],
  [57423, FUNCTIONAL_CODEPOINTS.home],
  [57424, FUNCTIONAL_CODEPOINTS.end],
  [57425, FUNCTIONAL_CODEPOINTS.insert],
  [57426, FUNCTIONAL_CODEPOINTS.delete],
]);

function normalizeKittyFunctionalCodepoint(codepoint: number): number {
  return KITTY_FUNCTIONAL_KEY_EQUIVALENTS.get(codepoint) ?? codepoint;
}

function normalizeShiftedLetterIdentityCodepoint(codepoint: number, modifier: number): number {
  const effectiveModifier = modifier & ~LOCK_MASK;
  if ((effectiveModifier & MODIFIERS.shift) !== 0 && codepoint >= 65 && codepoint <= 90) {
    return codepoint + 32;
  }
  return codepoint;
}

const LEGACY_SEQUENCE_KEY_IDS: Record<string, string> = {
  "\x1bOA": "up",
  "\x1bOB": "down",
  "\x1bOC": "right",
  "\x1bOD": "left",
  "\x1bOH": "home",
  "\x1bOF": "end",
  "\x1b[E": "clear",
  "\x1bOE": "clear",
  "\x1b[2~": "insert",
  "\x1b[a": "shift+up",
  "\x1b[b": "shift+down",
  "\x1b[c": "shift+right",
  "\x1b[d": "shift+left",
  "\x1bOa": "ctrl+up",
  "\x1bOb": "ctrl+down",
  "\x1bOc": "ctrl+right",
  "\x1bOd": "ctrl+left",
  "\x1b[5$": "shift+pageUp",
  "\x1b[6$": "shift+pageDown",
  "\x1b[7$": "shift+home",
  "\x1b[8$": "shift+end",
  "\x1b[5^": "ctrl+pageUp",
  "\x1b[6^": "ctrl+pageDown",
  "\x1b[7^": "ctrl+home",
  "\x1b[8^": "ctrl+end",
  "\x1bb": "alt+left",
  "\x1bf": "alt+right",
  "\x1bp": "alt+up",
  "\x1bn": "alt+down",
};

// =============================================================================
// Kitty Protocol Parsing
// =============================================================================

interface ParsedKittySequence {
  codepoint: number;
  shiftedKey?: number;
  baseLayoutKey?: number;
  modifier: number;
}

interface ParsedModifyOtherKeysSequence {
  codepoint: number;
  modifier: number;
}

function parseKittySequence(data: string): ParsedKittySequence | null {
  const csiUMatch = data.match(/^\x1b\[(\d+)(?::(\d*))?(?::(\d+))?(?:;(\d+))?(?::(\d+))?u$/);
  if (csiUMatch) {
    const codepoint = Number.parseInt(csiUMatch[1] ?? "", 10);
    const shiftedKey =
      csiUMatch[2] && csiUMatch[2].length > 0 ? Number.parseInt(csiUMatch[2], 10) : undefined;
    const baseLayoutKey = csiUMatch[3] ? Number.parseInt(csiUMatch[3], 10) : undefined;
    const modValue = csiUMatch[4] ? Number.parseInt(csiUMatch[4], 10) : 1;
    const result: ParsedKittySequence = { codepoint, modifier: modValue - 1 };
    if (shiftedKey !== undefined) result.shiftedKey = shiftedKey;
    if (baseLayoutKey !== undefined) result.baseLayoutKey = baseLayoutKey;
    return result;
  }

  const arrowMatch = data.match(/^\x1b\[1;(\d+)(?::(\d+))?([ABCD])$/);
  if (arrowMatch) {
    const modValue = Number.parseInt(arrowMatch[1] ?? "", 10);
    const arrowCodes: Record<string, number> = { A: -1, B: -2, C: -3, D: -4 };
    return { codepoint: arrowCodes[arrowMatch[3] ?? "A"] ?? 0, modifier: modValue - 1 };
  }

  const funcMatch = data.match(/^\x1b\[(\d+)(?:;(\d+))?(?::(\d+))?~$/);
  if (funcMatch) {
    const keyNum = Number.parseInt(funcMatch[1] ?? "", 10);
    const modValue = funcMatch[2] ? Number.parseInt(funcMatch[2], 10) : 1;
    const funcCodes: Record<number, number> = {
      2: FUNCTIONAL_CODEPOINTS.insert,
      3: FUNCTIONAL_CODEPOINTS.delete,
      5: FUNCTIONAL_CODEPOINTS.pageUp,
      6: FUNCTIONAL_CODEPOINTS.pageDown,
      7: FUNCTIONAL_CODEPOINTS.home,
      8: FUNCTIONAL_CODEPOINTS.end,
    };
    const codepoint = funcCodes[keyNum];
    if (codepoint !== undefined) {
      return { codepoint, modifier: modValue - 1 };
    }
  }

  const homeEndMatch = data.match(/^\x1b\[1;(\d+)(?::(\d+))?([HF])$/);
  if (homeEndMatch) {
    const modValue = Number.parseInt(homeEndMatch[1] ?? "", 10);
    const codepoint =
      homeEndMatch[3] === "H" ? FUNCTIONAL_CODEPOINTS.home : FUNCTIONAL_CODEPOINTS.end;
    return { codepoint, modifier: modValue - 1 };
  }

  return null;
}

function parseModifyOtherKeysSequence(data: string): ParsedModifyOtherKeysSequence | null {
  const match = data.match(/^\x1b\[27;(\d+);(\d+)~$/);
  if (!match) return null;
  const modValue = Number.parseInt(match[1] ?? "", 10);
  const codepoint = Number.parseInt(match[2] ?? "", 10);
  return { codepoint, modifier: modValue - 1 };
}

function isWindowsTerminalSession(): boolean {
  return (
    Boolean(process.env.WT_SESSION) &&
    !process.env.SSH_CONNECTION &&
    !process.env.SSH_CLIENT &&
    !process.env.SSH_TTY
  );
}

function formatKeyNameWithModifiers(keyName: string, modifier: number): string | undefined {
  const mods: string[] = [];
  const effectiveMod = modifier & ~LOCK_MASK;
  const supportedModifierMask = MODIFIERS.shift | MODIFIERS.ctrl | MODIFIERS.alt | MODIFIERS.super;
  if ((effectiveMod & ~supportedModifierMask) !== 0) return undefined;
  if (effectiveMod & MODIFIERS.shift) mods.push("shift");
  if (effectiveMod & MODIFIERS.ctrl) mods.push("ctrl");
  if (effectiveMod & MODIFIERS.alt) mods.push("alt");
  if (effectiveMod & MODIFIERS.super) mods.push("super");
  return mods.length > 0 ? `${mods.join("+")}+${keyName}` : keyName;
}

function formatParsedKey(
  codepoint: number,
  modifier: number,
  baseLayoutKey?: number,
): string | undefined {
  const normalizedCodepoint = normalizeKittyFunctionalCodepoint(codepoint);
  const identityCodepoint = normalizeShiftedLetterIdentityCodepoint(normalizedCodepoint, modifier);
  const isLatinLetter = identityCodepoint >= 97 && identityCodepoint <= 122;
  const isDigit = identityCodepoint >= 48 && identityCodepoint <= 57;
  const isKnownSymbol = SYMBOL_KEYS.has(String.fromCharCode(identityCodepoint));
  const effectiveCodepoint =
    isLatinLetter || isDigit || isKnownSymbol
      ? identityCodepoint
      : (baseLayoutKey ?? identityCodepoint);

  let keyName: string | undefined;
  if (effectiveCodepoint === CODEPOINTS.escape) keyName = "escape";
  else if (effectiveCodepoint === CODEPOINTS.tab) keyName = "tab";
  else if (effectiveCodepoint === CODEPOINTS.enter || effectiveCodepoint === CODEPOINTS.kpEnter)
    keyName = "enter";
  else if (effectiveCodepoint === CODEPOINTS.space) keyName = "space";
  else if (effectiveCodepoint === CODEPOINTS.backspace) keyName = "backspace";
  else if (effectiveCodepoint === FUNCTIONAL_CODEPOINTS.delete) keyName = "delete";
  else if (effectiveCodepoint === FUNCTIONAL_CODEPOINTS.insert) keyName = "insert";
  else if (effectiveCodepoint === FUNCTIONAL_CODEPOINTS.home) keyName = "home";
  else if (effectiveCodepoint === FUNCTIONAL_CODEPOINTS.end) keyName = "end";
  else if (effectiveCodepoint === FUNCTIONAL_CODEPOINTS.pageUp) keyName = "pageUp";
  else if (effectiveCodepoint === FUNCTIONAL_CODEPOINTS.pageDown) keyName = "pageDown";
  else if (effectiveCodepoint === ARROW_CODEPOINTS.up) keyName = "up";
  else if (effectiveCodepoint === ARROW_CODEPOINTS.down) keyName = "down";
  else if (effectiveCodepoint === ARROW_CODEPOINTS.left) keyName = "left";
  else if (effectiveCodepoint === ARROW_CODEPOINTS.right) keyName = "right";
  else if (effectiveCodepoint >= 48 && effectiveCodepoint <= 57)
    keyName = String.fromCharCode(effectiveCodepoint);
  else if (effectiveCodepoint >= 97 && effectiveCodepoint <= 122)
    keyName = String.fromCharCode(effectiveCodepoint);
  else if (SYMBOL_KEYS.has(String.fromCharCode(effectiveCodepoint)))
    keyName = String.fromCharCode(effectiveCodepoint);

  if (!keyName) return undefined;
  return formatKeyNameWithModifiers(keyName, modifier);
}

export function parseKey(data: string): string | undefined {
  const kitty = parseKittySequence(data);
  if (kitty) {
    return formatParsedKey(kitty.codepoint, kitty.modifier, kitty.baseLayoutKey);
  }

  const modifyOtherKeys = parseModifyOtherKeysSequence(data);
  if (modifyOtherKeys) {
    return formatParsedKey(modifyOtherKeys.codepoint, modifyOtherKeys.modifier);
  }

  if (_kittyProtocolActive) {
    if (data === "\x1b\r" || data === "\n") return "shift+enter";
  }

  const legacySequenceKeyId = LEGACY_SEQUENCE_KEY_IDS[data];
  if (legacySequenceKeyId) return legacySequenceKeyId;

  if (data === "\x1b") return "escape";
  if (data === "\x1c") return "ctrl+\\";
  if (data === "\x1d") return "ctrl+]";
  if (data === "\x1f") return "ctrl+-";
  if (data === "\x1b\x1b") return "ctrl+alt+[";
  if (data === "\x1b\x1c") return "ctrl+alt+\\";
  if (data === "\x1b\x1d") return "ctrl+alt+]";
  if (data === "\x1b\x1f") return "ctrl+alt+-";
  if (data === "\t") return "tab";
  if (data === "\r" || (!_kittyProtocolActive && data === "\n") || data === "\x1bOM")
    return "enter";
  if (data === "\x00") return "ctrl+space";
  if (data === " ") return "space";
  if (data === "\x7f") return "backspace";
  if (data === "\x08") return isWindowsTerminalSession() ? "ctrl+backspace" : "backspace";
  if (data === "\x1b[Z") return "shift+tab";
  if (!_kittyProtocolActive && data === "\x1b\r") return "alt+enter";
  if (!_kittyProtocolActive && data === "\x1b ") return "alt+space";
  if (data === "\x1b\x7f" || data === "\x1b\b") return "alt+backspace";
  if (!_kittyProtocolActive && data === "\x1bB") return "alt+left";
  if (!_kittyProtocolActive && data === "\x1bF") return "alt+right";
  if (!_kittyProtocolActive && data.length === 2 && data[0] === "\x1b") {
    const code = data.charCodeAt(1);
    if (code >= 1 && code <= 26) {
      return `ctrl+alt+${String.fromCharCode(code + 96)}`;
    }
    if ((code >= 97 && code <= 122) || (code >= 48 && code <= 57)) {
      return `alt+${String.fromCharCode(code)}`;
    }
  }
  if (data === "\x1b[A") return "up";
  if (data === "\x1b[B") return "down";
  if (data === "\x1b[C") return "right";
  if (data === "\x1b[D") return "left";
  if (data === "\x1b[H" || data === "\x1bOH") return "home";
  if (data === "\x1b[F" || data === "\x1bOF") return "end";
  if (data === "\x1b[3~") return "delete";
  if (data === "\x1b[5~") return "pageUp";
  if (data === "\x1b[6~") return "pageDown";

  if (data.length === 1) {
    const code = data.charCodeAt(0);
    if (code >= 1 && code <= 26) {
      return `ctrl+${String.fromCharCode(code + 96)}`;
    }
    if (code >= 32 && code <= 126) {
      return data;
    }
  }

  return undefined;
}

// =============================================================================
// Printable decoding (Kitty CSI-u / modifyOtherKeys)
// =============================================================================

const KITTY_CSI_U_REGEX = /^\x1b\[(\d+)(?::(\d*))?(?::(\d+))?(?:;(\d+))?(?::(\d+))?u$/;
const KITTY_PRINTABLE_ALLOWED_MODIFIERS = MODIFIERS.shift | LOCK_MASK;

function decodeKittyPrintable(data: string): string | undefined {
  const match = data.match(KITTY_CSI_U_REGEX);
  if (!match) return undefined;
  const codepoint = Number.parseInt(match[1] ?? "", 10);
  if (!Number.isFinite(codepoint)) return undefined;
  const shiftedKey = match[2] && match[2].length > 0 ? Number.parseInt(match[2], 10) : undefined;
  const modValue = match[4] ? Number.parseInt(match[4], 10) : 1;
  const modifier = Number.isFinite(modValue) ? modValue - 1 : 0;
  if ((modifier & ~KITTY_PRINTABLE_ALLOWED_MODIFIERS) !== 0) return undefined;
  if (modifier & (MODIFIERS.alt | MODIFIERS.ctrl)) return undefined;
  let effectiveCodepoint = codepoint;
  if (modifier & MODIFIERS.shift) {
    if (typeof shiftedKey === "number") {
      effectiveCodepoint = shiftedKey;
    } else if (codepoint >= 97 && codepoint <= 122) {
      // Terminal reports CSI-u with shift held but no alternate-key field
      // (kitty flag 1 without flag 4). Apply the ASCII shift transformation
      // for letters so capital A reads as "A" instead of "a".
      effectiveCodepoint = codepoint - 32;
    }
  }
  effectiveCodepoint = normalizeKittyFunctionalCodepoint(effectiveCodepoint);
  if (!Number.isFinite(effectiveCodepoint) || effectiveCodepoint < 32) return undefined;
  try {
    return String.fromCodePoint(effectiveCodepoint);
  } catch {
    return undefined;
  }
}

function decodeModifyOtherKeysPrintable(data: string): string | undefined {
  const parsed = parseModifyOtherKeysSequence(data);
  if (!parsed) return undefined;
  const modifier = parsed.modifier & ~LOCK_MASK;
  if ((modifier & ~MODIFIERS.shift) !== 0) return undefined;
  if (!Number.isFinite(parsed.codepoint) || parsed.codepoint < 32) return undefined;
  try {
    return String.fromCodePoint(parsed.codepoint);
  } catch {
    return undefined;
  }
}

export function decodePrintableKey(data: string): string | undefined {
  return decodeKittyPrintable(data) ?? decodeModifyOtherKeysPrintable(data);
}

// =============================================================================
// Sequence → InputEvent
// =============================================================================
//
// Components consume `InputEvent` (key/text/paste). The terminal layer frames
// raw stdin into individual sequences and forwards them; the runtime calls
// `sequenceToInputEvent` once per sequence. Release events and the kitty
// protocol response are filtered out before this is reached.

export const KITTY_RESPONSE_RE = /^\x1b\[\?(\d+)u$/;

// Detects kitty key-release events (event type 3). Ported from pi-mono. With
// flag 2 of the keyboard protocol active, the terminal emits both press and
// release events for each key — release events have ":3" before the
// terminator. Releases would otherwise duplicate every keypress.
export function isKeyRelease(data: string): boolean {
  if (data.includes("\x1b[200~")) {
    return false;
  }
  return (
    data.includes(":3u") ||
    data.includes(":3~") ||
    data.includes(":3A") ||
    data.includes(":3B") ||
    data.includes(":3C") ||
    data.includes(":3D") ||
    data.includes(":3H") ||
    data.includes(":3F")
  );
}

export function sequenceToInputEvent(sequence: string): InputEvent | undefined {
  if (sequence === "") return undefined;

  // Try to map this sequence to a key strata's components know about. Pi's
  // parseKey may return identifiers strata doesn't model (e.g. "a", "shift+B",
  // "ctrl+shift+p") — those should fall through to the printable/text path.
  const keyName = parseKey(sequence);
  if (keyName !== undefined) {
    const recognized = normalizeRecognizedKey(keyName);
    if (recognized !== undefined) {
      return { type: "key", key: recognized, raw: sequence };
    }
  }

  // CSI-u / modifyOtherKeys forms that decode to a printable character
  // (e.g. "\x1b[97u" → "a", "\x1b[27;2;65~" → "A").
  const printable = decodePrintableKey(sequence);
  if (printable !== undefined) {
    return { type: "text", text: printable, raw: sequence };
  }

  // Plain printable single character.
  if (sequence.length === 1) {
    const code = sequence.charCodeAt(0);
    if (code >= 32 && code !== 127) {
      return { type: "text", text: sequence, raw: sequence };
    }
  }
  return undefined;
}
