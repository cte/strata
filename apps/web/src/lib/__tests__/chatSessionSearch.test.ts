import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { ChatSessionSummary } from "@/lib/api";
import { filterChatSessionsClientSide } from "@/lib/chatSessionSearch";

describe("filterChatSessionsClientSide", () => {
  test("keeps recent order for an empty query", () => {
    const sessions = [
      session({ id: "sess-recent", title: "Most recent" }),
      session({ id: "sess-older", title: "Older" }),
    ];

    assert.deepEqual(
      filterChatSessionsClientSide(sessions, "", 1).map((item) => item.id),
      ["sess-recent"],
    );
  });

  test("fuzzy searches title, id, and model without a server round trip", () => {
    const sessions = [
      session({ id: "sess-alpha", title: "Alpha planning" }),
      session({ id: "sess-resume", title: "Resume interrupted run", model: "gpt-5.5" }),
      session({ id: "sess-model", title: "Model selection", model: "claude-opus" }),
    ];

    assert.deepEqual(
      filterChatSessionsClientSide(sessions, "resm").map((item) => item.id),
      ["sess-resume"],
    );
    assert.deepEqual(
      filterChatSessionsClientSide(sessions, "opus").map((item) => item.id),
      ["sess-model"],
    );
  });
});

function session(input: { id: string; title: string; model?: string }): ChatSessionSummary {
  return {
    id: input.id,
    title: input.title,
    kind: "chat",
    startedAt: "2026-05-23T00:00:00.000Z",
    endedAt: null,
    status: "completed",
    model: input.model ?? null,
  };
}
