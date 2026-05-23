import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  agentCompletionMessage,
  appendAssistantDelta,
  type ChatMessageView,
  messagesToTranscript,
} from "@/lib/chatRunModel";

describe("agentCompletionMessage", () => {
  test("suppresses explicit user-cancelled completions", () => {
    assert.equal(agentCompletionMessage("interrupted", "cancelled"), null);
  });

  test("still reports non-cancelled interrupted and failed completions", () => {
    assert.equal(
      agentCompletionMessage("interrupted", "server_restarted"),
      "Run was interrupted (server_restarted).",
    );
    assert.equal(agentCompletionMessage("failed", "model_error"), "Run failed (model_error).");
  });
});

describe("messagesToTranscript", () => {
  test("preserves streaming assistant run metadata so later deltas update instead of duplicating", () => {
    const existing: ChatMessageView[] = [
      {
        id: "user-current",
        role: "user",
        content: "hi",
        status: "complete",
        toolCalls: [],
      },
      {
        id: "assistant-current",
        role: "assistant",
        content: "Hello",
        status: "streaming",
        toolCalls: [],
        runId: "run-1",
        iteration: 1,
      },
    ];
    const persisted = [
      {
        id: 1,
        role: "user",
        content: "hi",
        ts: "2026-05-23T00:00:00.000Z",
        attachments: [],
        toolCalls: [],
        toolCallId: null,
        usage: null,
      },
      {
        id: 2,
        role: "assistant",
        content: "Hello",
        ts: "2026-05-23T00:00:01.000Z",
        attachments: [],
        toolCalls: [],
        toolCallId: null,
        usage: null,
      },
    ] as Parameters<typeof messagesToTranscript>[0];

    const merged = messagesToTranscript(persisted, existing);
    const afterDelta = appendAssistantDelta(merged, "run-1", 1, " world");
    const assistantMessages = afterDelta.filter((message) => message.role === "assistant");

    assert.equal(assistantMessages.length, 1);
    assert.equal(assistantMessages[0]?.id, "assistant-current");
    assert.equal(assistantMessages[0]?.content, "Hello world");
  });
});
