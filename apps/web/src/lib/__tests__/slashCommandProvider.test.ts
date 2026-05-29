import { describe, expect, test } from "bun:test";
import { createSlashCommandProvider, parseSlashCommand } from "../slashCommandProvider.js";

describe("slash command provider", () => {
  test("suggests commands from the leading slash token", () => {
    const provider = createSlashCommandProvider();
    expect(
      provider.provide({
        text: "/m",
        cursor: 2,
        signal: new AbortController().signal,
      }),
    ).toEqual({
      replaceStart: 0,
      replaceEnd: 2,
      items: [
        {
          label: "/model",
          value: "/model",
          description: "open model controls",
          kind: "command",
          commit: "run",
        },
      ],
    });
  });

  test("does not trigger mid-line or after command arguments", () => {
    const provider = createSlashCommandProvider();
    expect(
      provider.provide({
        text: "ask /help",
        cursor: 9,
        signal: new AbortController().signal,
      }),
    ).toBeUndefined();
    expect(
      provider.provide({
        text: "/help now",
        cursor: 9,
        signal: new AbortController().signal,
      }),
    ).toBeUndefined();
  });

  test("parses supported commands and arguments", () => {
    expect(parseSlashCommand("/help")).toEqual({ name: "help", args: "" });
    expect(parseSlashCommand("/model gpt-5.5")).toEqual({
      name: "model",
      args: "gpt-5.5",
    });
    expect(parseSlashCommand("not a command")).toBeUndefined();
    expect(parseSlashCommand("/unknown")).toBeUndefined();
  });
});
