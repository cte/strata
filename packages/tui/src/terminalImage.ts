/**
 * Terminal capability detection and image-encoding helpers, ported from
 * pi-mono's `tui/src/terminal-image.ts` with the iTerm2 + Kitty paths kept
 * and the rest trimmed. We support PNG/JPEG dimension probing inline; other
 * formats fall back to a sensible cell estimate.
 */

import process from "node:process";

export interface CellDimensions {
  widthPx: number;
  heightPx: number;
}

export interface ImageDimensions {
  widthPx: number;
  heightPx: number;
}

export interface TerminalCapabilities {
  images: "kitty" | "iterm2" | null;
  trueColor: boolean;
  hyperlinks: boolean;
}

const DEFAULT_CELL: CellDimensions = { widthPx: 9, heightPx: 18 };
let cachedCapabilities: TerminalCapabilities | null = null;

export function getCellDimensions(): CellDimensions {
  return DEFAULT_CELL;
}

export function detectCapabilities(): TerminalCapabilities {
  const termProgram = process.env.TERM_PROGRAM?.toLowerCase() ?? "";
  const term = process.env.TERM?.toLowerCase() ?? "";
  const colorTerm = process.env.COLORTERM?.toLowerCase() ?? "";

  // tmux/screen swallow OSC 8 and image protocols by default.
  const inTmuxOrScreen =
    Boolean(process.env.TMUX) || term.startsWith("tmux") || term.startsWith("screen");
  if (inTmuxOrScreen) {
    const trueColor = colorTerm === "truecolor" || colorTerm === "24bit";
    return { images: null, trueColor, hyperlinks: false };
  }

  if (process.env.KITTY_WINDOW_ID || termProgram === "kitty") {
    return { images: "kitty", trueColor: true, hyperlinks: true };
  }
  if (
    termProgram === "ghostty" ||
    term.includes("ghostty") ||
    process.env.GHOSTTY_RESOURCES_DIR
  ) {
    return { images: "kitty", trueColor: true, hyperlinks: true };
  }
  if (process.env.WEZTERM_PANE || termProgram === "wezterm") {
    return { images: "kitty", trueColor: true, hyperlinks: true };
  }
  if (process.env.ITERM_SESSION_ID || termProgram === "iterm.app") {
    return { images: "iterm2", trueColor: true, hyperlinks: true };
  }
  if (termProgram === "vscode" || termProgram === "alacritty") {
    return { images: null, trueColor: true, hyperlinks: termProgram === "vscode" };
  }
  const trueColor = colorTerm === "truecolor" || colorTerm === "24bit";
  return { images: null, trueColor, hyperlinks: false };
}

export function getCapabilities(): TerminalCapabilities {
  if (cachedCapabilities === null) {
    cachedCapabilities = detectCapabilities();
  }
  return cachedCapabilities;
}

/** Override the cached capabilities. Useful in tests. */
export function setCapabilities(caps: TerminalCapabilities | null): void {
  cachedCapabilities = caps;
}

const KITTY_PREFIX = "\x1b_G";
const ITERM2_PREFIX = "\x1b]1337;File=";

export function isImageLine(line: string): boolean {
  if (line.startsWith(KITTY_PREFIX) || line.startsWith(ITERM2_PREFIX)) return true;
  return line.includes(KITTY_PREFIX) || line.includes(ITERM2_PREFIX);
}

export function getPngDimensions(base64Data: string): ImageDimensions | null {
  try {
    const buffer = Buffer.from(base64Data, "base64");
    if (buffer.length < 24) return null;
    if (buffer[0] !== 0x89 || buffer[1] !== 0x50 || buffer[2] !== 0x4e || buffer[3] !== 0x47) {
      return null;
    }
    return { widthPx: buffer.readUInt32BE(16), heightPx: buffer.readUInt32BE(20) };
  } catch {
    return null;
  }
}

export function getJpegDimensions(base64Data: string): ImageDimensions | null {
  try {
    const buffer = Buffer.from(base64Data, "base64");
    if (buffer.length < 2 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
    let offset = 2;
    while (offset < buffer.length - 9) {
      if (buffer[offset] !== 0xff) {
        offset++;
        continue;
      }
      const marker = buffer[offset + 1] ?? 0;
      if (marker >= 0xc0 && marker <= 0xc2) {
        const height = buffer.readUInt16BE(offset + 5);
        const width = buffer.readUInt16BE(offset + 7);
        return { widthPx: width, heightPx: height };
      }
      if (offset + 3 >= buffer.length) return null;
      const length = buffer.readUInt16BE(offset + 2);
      if (length < 2) return null;
      offset += 2 + length;
    }
    return null;
  } catch {
    return null;
  }
}

export function getImageDimensions(
  base64Data: string,
  mimeType: string,
): ImageDimensions | null {
  if (mimeType === "image/png") return getPngDimensions(base64Data);
  if (mimeType === "image/jpeg") return getJpegDimensions(base64Data);
  return null;
}

export function calculateImageRows(
  imageDimensions: ImageDimensions,
  targetWidthCells: number,
  cellDimensions: CellDimensions = DEFAULT_CELL,
): number {
  const targetWidthPx = targetWidthCells * cellDimensions.widthPx;
  const scale = targetWidthPx / imageDimensions.widthPx;
  const scaledHeightPx = imageDimensions.heightPx * scale;
  return Math.max(1, Math.ceil(scaledHeightPx / cellDimensions.heightPx));
}

const KITTY_CHUNK_SIZE = 4096;

export function encodeKitty(
  base64Data: string,
  options: { columns?: number; rows?: number; imageId?: number } = {},
): string {
  const params: string[] = ["a=T", "f=100", "q=2"];
  if (options.columns !== undefined) params.push(`c=${options.columns}`);
  if (options.rows !== undefined) params.push(`r=${options.rows}`);
  if (options.imageId !== undefined) params.push(`i=${options.imageId}`);

  if (base64Data.length <= KITTY_CHUNK_SIZE) {
    return `${KITTY_PREFIX}${params.join(",")};${base64Data}\x1b\\`;
  }

  const chunks: string[] = [];
  let offset = 0;
  let isFirst = true;
  while (offset < base64Data.length) {
    const chunk = base64Data.slice(offset, offset + KITTY_CHUNK_SIZE);
    const isLast = offset + KITTY_CHUNK_SIZE >= base64Data.length;
    if (isFirst) {
      chunks.push(`${KITTY_PREFIX}${params.join(",")},m=1;${chunk}\x1b\\`);
      isFirst = false;
    } else if (isLast) {
      chunks.push(`${KITTY_PREFIX}m=0;${chunk}\x1b\\`);
    } else {
      chunks.push(`${KITTY_PREFIX}m=1;${chunk}\x1b\\`);
    }
    offset += KITTY_CHUNK_SIZE;
  }
  return chunks.join("");
}

export function encodeITerm2(
  base64Data: string,
  options: {
    width?: number | string;
    height?: number | string;
    name?: string;
    preserveAspectRatio?: boolean;
    inline?: boolean;
  } = {},
): string {
  const params: string[] = [`inline=${options.inline === false ? 0 : 1}`];
  if (options.width !== undefined) params.push(`width=${options.width}`);
  if (options.height !== undefined) params.push(`height=${options.height}`);
  if (options.name !== undefined) {
    params.push(`name=${Buffer.from(options.name).toString("base64")}`);
  }
  if (options.preserveAspectRatio === false) params.push("preserveAspectRatio=0");
  return `${ITERM2_PREFIX}${params.join(";")}:${base64Data}\x07`;
}

export interface ImageRenderOptions {
  maxWidthCells?: number;
  imageId?: number;
  preserveAspectRatio?: boolean;
}

/**
 * Returns the escape sequence + the number of terminal rows the image occupies.
 * Returns null if the terminal can't render images; the caller should fall
 * back to text. Default maxWidthCells caps the image at 80 columns wide.
 */
export function renderImage(
  base64Data: string,
  imageDimensions: ImageDimensions,
  options: ImageRenderOptions = {},
): { sequence: string; rows: number } | null {
  const caps = getCapabilities();
  if (caps.images === null) return null;
  const maxWidth = options.maxWidthCells ?? 80;
  const rows = calculateImageRows(imageDimensions, maxWidth, getCellDimensions());
  if (caps.images === "kitty") {
    const sequence = encodeKitty(base64Data, {
      columns: maxWidth,
      rows,
      ...(options.imageId !== undefined ? { imageId: options.imageId } : {}),
    });
    return { sequence, rows };
  }
  if (caps.images === "iterm2") {
    const sequence = encodeITerm2(base64Data, {
      width: maxWidth,
      height: "auto",
      preserveAspectRatio: options.preserveAspectRatio ?? true,
    });
    return { sequence, rows };
  }
  return null;
}

/** Plain-text fallback when the terminal can't render the image inline. */
export function imageFallback(
  mimeType: string,
  dimensions: ImageDimensions | null,
  filename?: string,
): string {
  const parts: string[] = ["[image"];
  if (filename !== undefined && filename !== "") parts.push(filename);
  parts.push(mimeType);
  if (dimensions !== null) parts.push(`${dimensions.widthPx}×${dimensions.heightPx}`);
  return `${parts.join(" · ")}]`;
}
