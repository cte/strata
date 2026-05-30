import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { ChatStreamEvent } from "@/lib/api";
import {
  agentCompletionMessage,
  appendAssistantDelta,
  appendAssistantReasoning,
  type ChatMessageView,
  finalizeAssistantResponse,
  messagesToTranscript,
  type TranscriptUpdate,
  transcriptUpdateForStreamEvent,
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

describe("streaming transcript updates", () => {
  test("final response replaces the streamed assistant message for the same run iteration", () => {
    const streamed = appendAssistantDelta(
      appendAssistantDelta([], "run-1", 1, "Hel"),
      "run-1",
      1,
      "lo",
    );

    const finalized = finalizeAssistantResponse(streamed, "run-1", 1, "Hello", [], undefined);
    const assistantMessages = finalized.filter((message) => message.role === "assistant");

    assert.equal(assistantMessages.length, 1);
    assert.equal(assistantMessages[0]?.content, "Hello");
    assert.equal(assistantMessages[0]?.status, "complete");
  });

  test("reasoning deltas accumulate on the same assistant message as the answer", () => {
    const afterReasoning = appendAssistantReasoning(
      appendAssistantReasoning([], "run-1", 1, "Let me "),
      "run-1",
      1,
      "think.",
    );
    const withAnswer = appendAssistantDelta(afterReasoning, "run-1", 1, "Hello");
    const finalized = finalizeAssistantResponse(
      withAnswer,
      "run-1",
      1,
      "Hello",
      [],
      undefined,
      "Let me think.",
    );
    const assistant = finalized.filter((message) => message.role === "assistant");

    assert.equal(assistant.length, 1);
    assert.equal(assistant[0]?.content, "Hello");
    assert.equal(assistant[0]?.reasoning, "Let me think.");
    assert.equal(assistant[0]?.status, "complete");
  });

  test("event updaters capture the run id before delayed React state flushing", () => {
    let runIdRef: string | null = "run-1";
    const pendingUpdates: TranscriptUpdate[] = [];

    pendingUpdates.push(
      transcriptUpdateForStreamEvent(
        { type: "assistant.delta", iteration: 1, contentDelta: "Hel" },
        runIdRef,
      ),
    );
    pendingUpdates.push(
      transcriptUpdateForStreamEvent(
        {
          type: "model.response",
          iteration: 1,
          content: "Hello",
          toolCalls: [],
        },
        runIdRef,
      ),
    );
    const completed: Extract<ChatStreamEvent, { type: "agent.completed" }> = {
      type: "agent.completed",
      result: {
        sessionId: "session-1",
        status: "completed",
        stoppedReason: "final_answer",
        finalAnswer: "Hello",
        iterations: 1,
        toolCalls: 0,
      },
    };
    if (completed.type === "agent.completed") {
      runIdRef = null;
    }

    const transcript = pendingUpdates.reduce<ChatMessageView[]>(
      (current, update) => update(current),
      [],
    );
    const assistantMessages = transcript.filter((message) => message.role === "assistant");

    assert.equal(assistantMessages.length, 1);
    assert.equal(assistantMessages[0]?.content, "Hello");
    assert.equal(assistantMessages[0]?.runId, "run-1");
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
