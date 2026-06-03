import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { ChatStreamEvent } from "@/lib/api";
import {
  agentCompletionMessage,
  appendAssistantDelta,
  appendAssistantReasoning,
  appendPendingUserMessageFromEvent,
  appendUserMessageFromEvent,
  type ChatMessageView,
  finalizeAssistantResponse,
  friendlyChatError,
  markPendingMessagesCancelled,
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

describe("friendlyChatError", () => {
  test("summarizes Anthropic rate limit payloads", () => {
    assert.deepEqual(
      friendlyChatError(
        "Anthropic request failed with HTTP 429 (rate_limit_error): This request would exceed your organization's rate limit. (request req_123)",
      ),
      {
        title: "Model rate limit reached",
        message: "This request would exceed your organization's rate limit.",
        requestId: "req_123",
        retryable: true,
      },
    );
  });
});

describe("streaming transcript updates", () => {
  test("appends streamed queued user messages", () => {
    const transcript = appendUserMessageFromEvent([], {
      type: "message.user",
      content: "steer now",
    });

    assert.equal(transcript.length, 1);
    assert.equal(transcript[0]?.role, "user");
    assert.equal(transcript[0]?.content, "steer now");
  });

  test("confirms pending steered user messages by client message id", () => {
    const pending = appendPendingUserMessageFromEvent([], {
      type: "message.user.pending",
      content: "steer now",
      clientMessageId: "queued-1",
    });

    assert.equal(pending.length, 1);
    assert.equal(pending[0]?.status, "streaming");
    assert.equal(pending[0]?.pendingKind, "steering");

    const confirmed = appendUserMessageFromEvent(pending, {
      type: "message.user",
      content: "steer now",
      clientMessageId: "queued-1",
    });

    assert.equal(confirmed.length, 1);
    assert.equal(confirmed[0]?.id, "pending-user-queued-1");
    assert.equal(confirmed[0]?.status, "complete");
    assert.equal(confirmed[0]?.pendingKind, undefined);
  });

  test("marks unconfirmed pending steering messages cancelled without failing confirmed turns", () => {
    const pending = appendPendingUserMessageFromEvent(
      [
        {
          id: "assistant-streaming",
          role: "assistant",
          content: "working",
          status: "streaming",
          toolCalls: [],
        },
        {
          id: "user-confirmed",
          role: "user",
          content: "already accepted",
          status: "complete",
          toolCalls: [],
          clientMessageId: "queued-confirmed",
        },
      ],
      {
        type: "message.user.pending",
        content: "not accepted yet",
        clientMessageId: "queued-pending",
      },
    );

    const cancelled = markPendingMessagesCancelled(pending);

    assert.equal(
      cancelled.find((message) => message.id === "assistant-streaming")?.status,
      "complete",
    );
    assert.equal(cancelled.find((message) => message.id === "user-confirmed")?.status, "complete");
    const pendingMessage = cancelled.find(
      (message) => message.clientMessageId === "queued-pending",
    );
    assert.equal(pendingMessage?.status, "error");
    assert.equal(pendingMessage?.pendingKind, "steering");
  });

  test("dedupes the optimistic first submitted user message", () => {
    const existing: ChatMessageView[] = [
      {
        id: "user-current",
        role: "user",
        content: "hello",
        status: "complete",
        toolCalls: [],
      },
    ];

    const transcript = appendUserMessageFromEvent(
      existing,
      { type: "message.user", content: "hello" },
      { dedupeLast: true },
    );

    assert.equal(transcript.length, 1);
    assert.equal(transcript[0]?.id, "user-current");
  });

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
