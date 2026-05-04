import { describe, expect, test } from "bun:test";
import { Editor } from "./editor.js";
import { SlashCommandRegistry } from "./commands.js";

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
