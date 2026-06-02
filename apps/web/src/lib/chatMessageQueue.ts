import { type AttachmentData, getAttachmentLabel } from "@/components/ai-elements/attachments";
import type { ChatQueuedMessageSummary } from "@/lib/api";

export type QueuedChatMessageDelivery = "steering" | "follow-up";

export interface QueuedChatMessage {
  id: string;
  message: string;
  attachments: AttachmentData[];
  delivery: QueuedChatMessageDelivery;
}

export function queuedChatMessageFromSummary(summary: ChatQueuedMessageSummary): QueuedChatMessage {
  return {
    id: summary.id,
    message: summary.message,
    attachments: attachmentDataFromJson(summary.attachments),
    delivery: summary.delivery,
  };
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
  const parts = [message.delivery === "steering" ? "Steering" : "Queued"];
  if (message.attachments.length > 0) {
    const count = message.attachments.length;
    parts.push(`${count} attachment${count === 1 ? "" : "s"}`);
  }
  return parts.join(" · ");
}

function attachmentDataFromJson(value: ChatQueuedMessageSummary["attachments"]): AttachmentData[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const attachments: AttachmentData[] = [];
  for (const item of value) {
    if (isAttachmentData(item)) {
      attachments.push(item);
    }
  }
  return attachments;
}

function isAttachmentData(value: unknown): value is AttachmentData {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    record.type === "file" &&
    typeof record.mediaType === "string" &&
    typeof record.url === "string" &&
    (record.filename === undefined || typeof record.filename === "string")
  );
}
