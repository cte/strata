import type { Meta, StoryObj } from "@storybook/react-vite";
import { CopyIcon, RotateCcwIcon, ThumbsDownIcon, ThumbsUpIcon } from "lucide-react";
import {
  Message,
  MessageAction,
  MessageActions,
  MessageAvatar,
  MessageContent,
  MessageMeta,
  MessageResponse,
} from "./message";

const meta = {
  title: "AI Elements/Message",
  component: Message,
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
  },
  args: {
    from: "assistant",
  },
} satisfies Meta<typeof Message>;

export default meta;
type Story = StoryObj<typeof meta>;

const ASSISTANT_MARKDOWN = `Here's what I found across the wiki:

- **Priorities** are tracked in \`wiki/priorities.md\`.
- The taxonomy review queue stages \`schema\` proposals for review.

Let me know if you'd like a follow-up note drafted.`;

/** A user message paired with an assistant reply — avatar, meta, content, and actions. */
export const Default: Story = {
  render: () => (
    <div className="flex flex-col gap-6">
      <Message from="user">
        <MessageContent>What did we decide about the taxonomy review queue?</MessageContent>
      </Message>

      <Message from="assistant">
        <MessageAvatar>AI</MessageAvatar>
        <div className="min-w-0 flex-1">
          <MessageMeta>Assistant · 10:42</MessageMeta>
          <MessageContent>
            <MessageResponse>{ASSISTANT_MARKDOWN}</MessageResponse>
          </MessageContent>
          <MessageActions>
            <MessageAction tooltip="Copy">
              <CopyIcon />
            </MessageAction>
            <MessageAction tooltip="Retry">
              <RotateCcwIcon />
            </MessageAction>
            <MessageAction tooltip="Good response">
              <ThumbsUpIcon />
            </MessageAction>
            <MessageAction tooltip="Bad response">
              <ThumbsDownIcon />
            </MessageAction>
          </MessageActions>
        </div>
      </Message>
    </div>
  ),
};

/** An assistant message in the error state. */
export const ErrorState: Story = {
  render: () => (
    <Message from="assistant" status="error">
      <MessageAvatar>AI</MessageAvatar>
      <div className="min-w-0 flex-1">
        <MessageMeta>Assistant · failed</MessageMeta>
        <MessageContent>The model request was interrupted. Try again in a moment.</MessageContent>
      </div>
    </Message>
  ),
};
