import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { AttachmentData } from "@/components/ai-elements/attachments";
import type { ChatQueuedMessageSummary } from "@/lib/api";
import {
  type QueuedChatMessage,
  queuedChatMessageDescription,
  queuedChatMessageFromSummary,
  queuedChatMessageLabel,
} from "@/lib/chatMessageQueue";

describe("chat message queue", () => {
  test("labels attachment-only messages from the attachment", () => {
    const queued = message("", "1", [
      {
        id: "att-1",
        type: "file",
        mediaType: "image/png",
        filename: "screenshot.png",
        url: "data:image/png;base64,",
      },
    ]);

    assert.equal(queuedChatMessageLabel(queued), "screenshot.png");
    assert.equal(queuedChatMessageDescription(queued), "Steering · 1 attachment");
  });

  test("maps durable queue summaries into prompt queue messages", () => {
    const queued = queuedChatMessageFromSummary({
      id: "queued-1",
      sessionId: "session-1",
      message: "follow up",
      attachments: [
        {
          id: "att-1",
          type: "file",
          mediaType: "image/png",
          filename: "screenshot.png",
          url: "data:image/png;base64,",
        },
        { bad: true },
      ],
      delivery: "follow-up",
      createdAt: "2026-05-26T00:00:00.000Z",
      position: 1,
    } satisfies ChatQueuedMessageSummary);

    assert.equal(queued.id, "queued-1");
    assert.equal(queued.message, "follow up");
    assert.equal(queued.delivery, "follow-up");
    assert.deepEqual(
      queued.attachments.map((attachment) => attachment.id),
      ["att-1"],
    );
  });
});

function message(value: string, id = value, attachments: AttachmentData[] = []): QueuedChatMessage {
  return {
    id,
    message: value,
    attachments,
    delivery: "steering",
  };
}
