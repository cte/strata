import type { Meta, StoryObj } from "@storybook/react-vite";
import { MessagesSquare } from "lucide-react";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "./conversation";
import { Message, MessageAvatar, MessageContent } from "./message";

const meta = {
  title: "AI Elements/Conversation",
  component: Conversation,
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
  },
  args: {
    children: null,
  },
} satisfies Meta<typeof Conversation>;

export default meta;
type Story = StoryObj<typeof meta>;

const SAMPLE_MESSAGES: Array<{ from: "user" | "assistant"; text: string }> = [
  { from: "user", text: "What did we decide about the taxonomy review queue?" },
  {
    from: "assistant",
    text: "We decided reviewer corrections apply immediately, while LLM suggestions stage schema proposals for review.",
  },
  { from: "user", text: "And who owns the daily routine?" },
  {
    from: "assistant",
    text: "The Granola daily TODO routine produces schema-valid artifacts before any write-back to /actions.",
  },
  { from: "user", text: "Got it — can you draft a follow-up note?" },
  {
    from: "assistant",
    text: "Sure. I'll summarize the decision, the open thread on write-back, and tag the owners for sign-off.",
  },
];

/** A scroll container holding a back-and-forth conversation. */
export const Default: Story = {
  render: () => (
    <div className="h-[480px] overflow-hidden rounded-md border border-hairline">
      <Conversation>
        <ConversationContent>
          {SAMPLE_MESSAGES.map((message, index) => (
            <Message key={index} from={message.from}>
              {message.from === "assistant" ? <MessageAvatar>AI</MessageAvatar> : null}
              <MessageContent>{message.text}</MessageContent>
            </Message>
          ))}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>
    </div>
  ),
};

/** The empty state shown before any messages exist. */
export const Empty: Story = {
  render: () => (
    <div className="h-[480px] overflow-hidden rounded-md border border-hairline">
      <Conversation>
        <ConversationContent>
          <ConversationEmptyState
            title="No messages yet"
            description="Ask about priorities, projects, decisions, or open threads to get started."
            icon={<MessagesSquare size={24} strokeWidth={1.5} />}
          />
        </ConversationContent>
      </Conversation>
    </div>
  ),
};
