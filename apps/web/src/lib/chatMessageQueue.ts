import { type AttachmentData, getAttachmentLabel } from "@/components/ai-elements/attachments";

export interface QueuedChatMessage {
  id: string;
  message: string;
  attachments: AttachmentData[];
}

export function appendQueuedChatMessage(
  queue: QueuedChatMessage[],
  message: QueuedChatMessage,
): QueuedChatMessage[] {
  return [...queue, message];
}

export function dequeueQueuedChatMessage(queue: QueuedChatMessage[]): {
  next: QueuedChatMessage | null;
  queue: QueuedChatMessage[];
} {
  const [next, ...remaining] = queue;
  return {
    next: next ?? null,
    queue: remaining,
  };
}

export function removeQueuedChatMessage(
  queue: QueuedChatMessage[],
  id: string,
): QueuedChatMessage[] {
  return queue.filter((message) => message.id !== id);
}

export function queuedChatMessageLabel(message: QueuedChatMessage): string {
  const text = message.message.trim();
  if (text !== "") {
    return text;
  }

  const attachment = message.attachments[0];
  return attachment === undefined ? "Queued message" : getAttachmentLabel(attachment);
}

export function queuedChatMessageDescription(message: QueuedChatMessage): string | null {
  if (message.attachments.length === 0) {
    return null;
  }

  const count = message.attachments.length;
  return `${count} attachment${count === 1 ? "" : "s"}`;
}
