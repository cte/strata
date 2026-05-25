import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { AttachmentData } from "@/components/ai-elements/attachments";
import {
  appendQueuedChatMessage,
  dequeueQueuedChatMessage,
  type QueuedChatMessage,
  queuedChatMessageDescription,
  queuedChatMessageLabel,
  removeQueuedChatMessage,
} from "@/lib/chatMessageQueue";

describe("chat message queue", () => {
  test("appends and dequeues messages in FIFO order", () => {
    const queue = appendQueuedChatMessage(
      appendQueuedChatMessage([], message("first")),
      message("second"),
    );

    const first = dequeueQueuedChatMessage(queue);
    const second = dequeueQueuedChatMessage(first.queue);

    assert.equal(first.next?.message, "first");
    assert.equal(second.next?.message, "second");
    assert.deepEqual(second.queue, []);
  });

  test("removes queued messages by id", () => {
    const queue = [message("keep", "1"), message("remove", "2"), message("also keep", "3")];

    assert.deepEqual(
      removeQueuedChatMessage(queue, "2").map((item) => item.id),
      ["1", "3"],
    );
  });

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
    assert.equal(queuedChatMessageDescription(queued), "1 attachment");
  });
});

function message(value: string, id = value, attachments: AttachmentData[] = []): QueuedChatMessage {
  return {
    id,
    message: value,
    attachments,
  };
}
