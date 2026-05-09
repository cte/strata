import { describe, expect, test } from "bun:test";
import { SlashCommandRegistry } from "./commands.js";
import { Editor } from "./editor.js";

function feed(editor: Editor, text: string): void {
  for (const ch of text) {
    editor.handleInput({ type: "text", text: ch, raw: ch });
  }
}

describe("Editor", () => {
  test("appends typed text and submits on enter", () => {
    let submitted = "";
    const editor = new Editor({ onSubmit: (text) => (submitted = text) });
    feed(editor, "hello");
    editor.handleInput({ type: "key", key: "enter", raw: "\r" });
    expect(submitted).toBe("hello");
    expect(editor.text).toBe("");
  });

  test("backspace deletes the prior character", () => {
    const editor = new Editor();
    feed(editor, "abc");
    editor.handleInput({ type: "key", key: "backspace", raw: "\x7f" });
    expect(editor.text).toBe("ab");
    expect(editor.cursor).toBe(2);
  });

  test("ctrl+w deletes the previous word", () => {
    const editor = new Editor();
    feed(editor, "hello world");
    editor.handleInput({ type: "key", key: "ctrl+w", raw: "\x17" });
    expect(editor.text).toBe("hello ");
  });

  test("history cycles previous submissions", () => {
    const editor = new Editor();
    feed(editor, "first");
    editor.handleInput({ type: "key", key: "enter", raw: "\r" });
    feed(editor, "second");
    editor.handleInput({ type: "key", key: "enter", raw: "\r" });
    editor.handleInput({ type: "key", key: "up", raw: "" });
    expect(editor.text).toBe("second");
    editor.handleInput({ type: "key", key: "up", raw: "" });
    expect(editor.text).toBe("first");
  });

  test("up-arrow stops at the oldest entry instead of wrapping", () => {
    const editor = new Editor();
    feed(editor, "alpha");
    editor.handleInput({ type: "key", key: "enter", raw: "\r" });
    feed(editor, "beta");
    editor.handleInput({ type: "key", key: "enter", raw: "\r" });
    // Up to the most-recent ("beta"), then to "alpha", then up again should
    // stay at "alpha" — pi's behavior. Previously strata wrapped: it cleared
    // the editor on the third Up and then went back to "beta" on the fourth.
    editor.handleInput({ type: "key", key: "up", raw: "" });
    expect(editor.text).toBe("beta");
    editor.handleInput({ type: "key", key: "up", raw: "" });
    expect(editor.text).toBe("alpha");
    editor.handleInput({ type: "key", key: "up", raw: "" });
    expect(editor.text).toBe("alpha");
    editor.handleInput({ type: "key", key: "up", raw: "" });
    expect(editor.text).toBe("alpha");
  });

  test("down-arrow returns to the empty current state past the newest", () => {
    const editor = new Editor();
    feed(editor, "alpha");
    editor.handleInput({ type: "key", key: "enter", raw: "\r" });
    editor.handleInput({ type: "key", key: "up", raw: "" });
    expect(editor.text).toBe("alpha");
    editor.handleInput({ type: "key", key: "down", raw: "" });
    expect(editor.text).toBe("");
  });

  test("paste inserts content as-is", () => {
    const editor = new Editor();
    editor.handleInput({ type: "paste", text: "abc\ndef", raw: "abc\ndef" });
    expect(editor.text).toBe("abc\ndef");
  });

  test("autocomplete cycles slash commands", () => {
    const registry = new SlashCommandRegistry();
    registry.register({ name: "help", description: "show help", run: () => {} });
    registry.register({ name: "clear", description: "clear screen", run: () => {} });
    let submitted: string | undefined;
    const editor = new Editor({ autocomplete: registry, onSubmit: (t) => (submitted = t) });
    feed(editor, "/h");
    editor.handleInput({ type: "key", key: "tab", raw: "\t" });
    expect(editor.text).toBe("/help");
    editor.handleInput({ type: "key", key: "enter", raw: "\r" });
    expect(submitted).toBe("/help");
  });

  test("enter on a non-slash completion applies but does not submit", () => {
    // Pi-aligned: only slash-command completions submit on Enter. File
    // mentions (@-prefix) and any other non-slash completion should leave
    // the editor on the current line so the user can keep typing.
    const provider = {
      provide: (text: string, cursor: number) =>
        text.startsWith("@")
          ? {
              items: [
                {
                  label: "alpha.md",
                  value: "@wiki/projects/alpha.md",
                  description: "wiki/projects/alpha.md",
                },
              ],
              replaceStart: 0,
              replaceEnd: cursor,
            }
          : undefined,
    };
    let submitted: string | undefined;
    const editor = new Editor({ autocomplete: provider, onSubmit: (text) => (submitted = text) });
    feed(editor, "@a");
    editor.handleInput({ type: "key", key: "enter", raw: "\r" });
    expect(submitted).toBeUndefined();
    expect(editor.text).toBe("@wiki/projects/alpha.md");
  });

  test("enter applies the highlighted completion and submits", () => {
    const registry = new SlashCommandRegistry();
    registry.register({ name: "help", description: "show help", run: () => {} });
    registry.register({ name: "history", description: "show history", run: () => {} });
    let submitted: string | undefined;
    const editor = new Editor({ autocomplete: registry, onSubmit: (t) => (submitted = t) });
    feed(editor, "/h");
    editor.handleInput({ type: "key", key: "down", raw: "" });
    editor.handleInput({ type: "key", key: "enter", raw: "\r" });
    expect(submitted).toBe("/history");
  });

  test("submit triggers slash-command parse", () => {
    const registry = new SlashCommandRegistry();
    let invoked: string | undefined;
    registry.register({
      name: "quit",
      description: "exit",
      run(args) {
        invoked = args;
      },
    });
    const parsed = registry.parse("/quit now");
    expect(parsed?.command.name).toBe("quit");
    expect(parsed?.args).toBe("now");
    parsed?.command.run(parsed.args);
    expect(invoked).toBe("now");
  });
});
