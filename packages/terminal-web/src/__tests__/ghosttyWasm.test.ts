import { describe, expect, test } from "bun:test";
import {
  GHOSTTY_CELL_SIZE,
  GhosttyCellFlags,
  type GhosttyWasmExports,
  GhosttyWasmTerminal,
  loadGhosttyWasmTerminal,
} from "../ghosttyWasm.js";

describe("GhosttyWasmTerminal", () => {
  test("owns terminal lifecycle and writes input bytes through WASM memory", () => {
    const fake = createFakeGhosttyExports();
    const terminal = new GhosttyWasmTerminal(fake.exports, 4, 2);

    terminal.write("hi");
    terminal.resize(6, 3);
    terminal.dispose();

    expect(fake.created).toEqual([{ cols: 4, rows: 2 }]);
    expect(fake.writes).toEqual(["hi"]);
    expect(fake.resizes).toEqual([{ handle: 7, cols: 6, rows: 3 }]);
    expect(fake.freedTerminals).toEqual([7]);
  });

  test("converts render-state cells and modes into Strata snapshots", () => {
    const fake = createFakeGhosttyExports();
    fake.cursor = { x: 1, y: 0 };
    fake.alternateScreen = true;
    fake.bracketedPaste = true;
    fake.cells = [
      {
        char: "R",
        foreground: [255, 0, 0],
        background: [0, 0, 0],
        flags: GhosttyCellFlags.Bold | GhosttyCellFlags.Underline,
      },
      {
        char: " ",
        foreground: [204, 204, 204],
        background: [0, 0, 0],
        flags: 0,
      },
    ];

    const terminal = new GhosttyWasmTerminal(fake.exports, 2, 1);

    expect(terminal.snapshot()).toEqual({
      cols: 2,
      rows: 1,
      cursor: { x: 1, y: 0 },
      modes: {
        alternateScreen: true,
        bracketedPaste: true,
        applicationCursor: false,
        mouseTracking: false,
        sgrMouse: false,
      },
      scrollbackCells: [],
      cells: [
        [
          {
            char: "R",
            style: {
              foreground: "#ff0000",
              bold: true,
              underline: true,
            },
          },
          { char: " " },
        ],
      ],
    });
  });

  test("rejects use after dispose", () => {
    const fake = createFakeGhosttyExports();
    const terminal = new GhosttyWasmTerminal(fake.exports, 2, 1);

    terminal.dispose();

    expect(() => terminal.write("x")).toThrow("disposed");
    expect(() => terminal.snapshot()).toThrow("disposed");
  });

  test("decodes scrollback, graphemes, and hyperlinks when exports provide them", () => {
    const fake = createFakeGhosttyExports();
    fake.cells = [
      {
        char: "界",
        foreground: [204, 204, 204],
        background: [0, 0, 0],
        flags: 0,
        width: 2,
        hyperlink: "https://example.com",
      },
    ];
    fake.scrollbackCells = [
      [
        {
          char: "e\u0301",
          foreground: [204, 204, 204],
          background: [0, 0, 0],
          flags: 0,
          grapheme: [0x65, 0x0301],
        },
      ],
    ];

    const terminal = new GhosttyWasmTerminal(fake.exports, 1, 1);
    const snapshot = terminal.snapshot();

    expect(snapshot.cells[0]?.[0]).toMatchObject({
      char: "界",
      width: 2,
      hyperlink: "https://example.com",
    });
    expect(snapshot.scrollbackCells[0]?.[0]?.char).toBe("e\u0301");
  });

  test("loads the bundled Ghostty WASM artifact", async () => {
    const terminal = await loadGhosttyWasmTerminal({
      wasmUrl: new URL("../../assets/ghostty-vt.wasm", import.meta.url),
      cols: 8,
      rows: 2,
    });

    terminal.write("hi");

    expect(lines(terminal.snapshot())[0]).toContain("hi");
    terminal.dispose();
  });

  test("keeps real WASM snapshots stable when grapheme lookups grow memory", async () => {
    const terminal = await loadGhosttyWasmTerminal({
      wasmUrl: new URL("../../assets/ghostty-vt.wasm", import.meta.url),
      cols: 68,
      rows: 16,
    });

    terminal.write(
      [
        "\x1b]8;;https://example.com\x07LINK\x1b]8;;\x07",
        "wide:界 emoji:😀 accent:e\u0301",
        ...Array.from({ length: 80 }, (_, index) => `LINE_${index + 1}`),
      ].join("\n"),
    );

    const snapshot = terminal.snapshot();
    expect(lines(snapshot).join("\n")).toContain("LINE_80");
    expect(snapshot.scrollbackCells.length).toBeGreaterThan(0);
    terminal.dispose();
  });
});

interface FakeCell {
  char: string;
  foreground: [number, number, number];
  background: [number, number, number];
  flags: number;
  width?: number;
  grapheme?: number[];
  hyperlink?: string;
}

function createFakeGhosttyExports(): {
  exports: GhosttyWasmExports;
  created: { cols: number; rows: number }[];
  writes: string[];
  resizes: { handle: number; cols: number; rows: number }[];
  freedTerminals: number[];
  cursor: { x: number; y: number };
  alternateScreen: boolean;
  bracketedPaste: boolean;
  cells: FakeCell[];
  scrollbackCells: FakeCell[][];
} {
  const memory = new WebAssembly.Memory({ initial: 1 });
  let nextPtr = 1024;
  const created: { cols: number; rows: number }[] = [];
  const writes: string[] = [];
  const resizes: { handle: number; cols: number; rows: number }[] = [];
  const freedTerminals: number[] = [];
  const state = {
    exports: undefined as unknown as GhosttyWasmExports,
    created,
    writes,
    resizes,
    freedTerminals,
    cursor: { x: 0, y: 0 },
    alternateScreen: false,
    bracketedPaste: false,
    cells: [] as FakeCell[],
    scrollbackCells: [] as FakeCell[][],
  };

  state.exports = {
    memory,
    ghostty_wasm_alloc_u8_array: (size: number) => {
      const ptr = nextPtr;
      nextPtr += Math.max(size, 1);
      return ptr;
    },
    ghostty_wasm_free_u8_array: () => {},
    ghostty_terminal_new: (cols: number, rows: number) => {
      created.push({ cols, rows });
      return 7;
    },
    ghostty_terminal_free: (handle: number) => {
      freedTerminals.push(handle);
    },
    ghostty_terminal_resize: (handle: number, cols: number, rows: number) => {
      resizes.push({ handle, cols, rows });
    },
    ghostty_terminal_write: (_handle: number, dataPtr: number, dataLen: number) => {
      writes.push(new TextDecoder().decode(new Uint8Array(memory.buffer, dataPtr, dataLen)));
    },
    ghostty_render_state_update: () => 2,
    ghostty_render_state_get_cursor_x: () => state.cursor.x,
    ghostty_render_state_get_cursor_y: () => state.cursor.y,
    ghostty_render_state_get_viewport: (_handle: number, bufferPtr: number, cellCount: number) => {
      writeCells(memory.buffer, bufferPtr, state.cells, cellCount);
      return cellCount;
    },
    ghostty_terminal_is_alternate_screen: () => state.alternateScreen,
    ghostty_terminal_get_mode: (_handle: number, mode: number, isAnsi: boolean) =>
      mode === 2004 && !isAnsi ? state.bracketedPaste : false,
    ghostty_render_state_get_grapheme: (
      _handle: number,
      row: number,
      col: number,
      bufferPtr: number,
      bufferSize: number,
    ) => writeGrapheme(memory.buffer, bufferPtr, bufferSize, viewportCell(state, row, col)),
    ghostty_terminal_get_scrollback_length: () => state.scrollbackCells.length,
    ghostty_terminal_get_scrollback_line: (
      _handle: number,
      offset: number,
      bufferPtr: number,
      cellCount: number,
    ) => {
      writeCells(memory.buffer, bufferPtr, state.scrollbackCells[offset] ?? [], cellCount);
      return cellCount;
    },
    ghostty_terminal_get_scrollback_grapheme: (
      _handle: number,
      offset: number,
      col: number,
      bufferPtr: number,
      bufferSize: number,
    ) => writeGrapheme(memory.buffer, bufferPtr, bufferSize, state.scrollbackCells[offset]?.[col]),
    ghostty_terminal_get_hyperlink_uri: (
      _handle: number,
      row: number,
      col: number,
      bufferPtr: number,
      bufferSize: number,
    ) => writeUri(memory.buffer, bufferPtr, bufferSize, viewportCell(state, row, col)?.hyperlink),
    ghostty_terminal_get_scrollback_hyperlink_uri: (
      _handle: number,
      offset: number,
      col: number,
      bufferPtr: number,
      bufferSize: number,
    ) =>
      writeUri(
        memory.buffer,
        bufferPtr,
        bufferSize,
        state.scrollbackCells[offset]?.[col]?.hyperlink,
      ),
  };

  return state;
}

function viewportCell(
  state: ReturnType<typeof createFakeGhosttyExports>,
  row: number,
  col: number,
): FakeCell | undefined {
  const cols = state.created.at(-1)?.cols ?? 1;
  return state.cells[row * cols + col];
}

function writeCells(
  buffer: ArrayBuffer,
  ptr: number,
  cells: readonly FakeCell[],
  cellCount: number,
): void {
  const bytes = new Uint8Array(buffer, ptr, cellCount * GHOSTTY_CELL_SIZE);
  const view = new DataView(buffer, ptr, cellCount * GHOSTTY_CELL_SIZE);
  for (let index = 0; index < cellCount; index += 1) {
    const cell = cells[index] ?? {
      char: " ",
      foreground: [204, 204, 204] as [number, number, number],
      background: [0, 0, 0] as [number, number, number],
      flags: 0,
    };
    const offset = index * GHOSTTY_CELL_SIZE;
    view.setUint32(offset, cell.char.codePointAt(0) ?? 32, true);
    bytes[offset + 4] = cell.foreground[0];
    bytes[offset + 5] = cell.foreground[1];
    bytes[offset + 6] = cell.foreground[2];
    bytes[offset + 7] = cell.background[0];
    bytes[offset + 8] = cell.background[1];
    bytes[offset + 9] = cell.background[2];
    bytes[offset + 10] = cell.flags;
    bytes[offset + 11] = cell.width ?? 1;
    bytes[offset + 12] = cell.hyperlink === undefined ? 0 : 1;
    bytes[offset + 14] = cell.grapheme === undefined ? 0 : cell.grapheme.length - 1;
  }
}

function writeGrapheme(
  buffer: ArrayBuffer,
  ptr: number,
  bufferSize: number,
  cell: FakeCell | undefined,
): number {
  if (cell?.grapheme === undefined) return -1;
  const count = Math.min(bufferSize, cell.grapheme.length);
  const view = new DataView(buffer, ptr, count * 4);
  for (let index = 0; index < count; index += 1) {
    view.setUint32(index * 4, cell.grapheme[index] ?? 32, true);
  }
  return count;
}

function writeUri(
  buffer: ArrayBuffer,
  ptr: number,
  bufferSize: number,
  uri: string | undefined,
): number {
  if (uri === undefined) return 0;
  const bytes = new TextEncoder().encode(uri);
  if (bytes.length > bufferSize) return -1;
  new Uint8Array(buffer, ptr, bytes.length).set(bytes);
  return bytes.length;
}

function lines(snapshot: {
  cells: readonly (readonly { char: string; continuation?: boolean }[])[];
}): string[] {
  return snapshot.cells.map((row) =>
    row.map((cell) => (cell.continuation === true ? "" : cell.char)).join(""),
  );
}
