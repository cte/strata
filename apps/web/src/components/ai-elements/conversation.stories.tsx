import type { Meta, StoryObj } from "@storybook/react-vite";
import { MessagesSquare } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
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

/**
 * Mirrors the chat surface's composer-clearance mechanism so the autoscroll
 * behavior can be exercised without the full ChatPage.
 *
 * The composer is absolutely positioned over the conversation; its measured
 * border-box height is published to `--composer-h` via a ResizeObserver, and an
 * in-flow spacer of `calc(var(--composer-h) + 1rem)` at the end of the
 * transcript reserves exactly that space INSIDE the scroll content box.
 *
 * Two invariants this guards:
 * 1. Growing the composer (toggle below) re-pins to the bottom when already at
 *    bottom — because the spacer is in-flow, use-stick-to-bottom's content
 *    ResizeObserver sees the growth. A padding-based reservation would not, and
 *    the last message would be overlapped instead of scrolling into view.
 * 2. There is no large dead gap above the composer — ConversationContent's
 *    default pb is zeroed (`pb-0`) so the spacer is the SOLE reservation rather
 *    than stacking with the base padding.
 *
 * Toggle the composer height and watch the last message stay parked just above
 * the composer with the bottom flush, not floating in a gap.
 */
export const ComposerClearance: Story = {
  render: () => <ComposerClearanceDemo />,
};

function usePublishedHeight(
  targetRef: React.RefObject<HTMLElement | null>,
  property: string,
): React.RefObject<HTMLDivElement | null> {
  const measuredRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const measured = measuredRef.current;
    const target = targetRef.current;
    if (measured === null || target === null) {
      return;
    }
    const publish = () => {
      target.style.setProperty(property, `${Math.ceil(measured.getBoundingClientRect().height)}px`);
    };
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(measured);
    return () => {
      observer.disconnect();
      target.style.removeProperty(property);
    };
  }, [targetRef, property]);
  return measuredRef;
}

function ComposerClearanceDemo(): React.ReactElement {
  const [tall, setTall] = useState(false);
  const sectionRef = useRef<HTMLElement | null>(null);
  const composerRef = usePublishedHeight(sectionRef, "--composer-h");

  return (
    <section
      ref={sectionRef}
      className="relative h-[480px] overflow-hidden rounded-md border border-hairline"
    >
      <Conversation className="h-full">
        <ConversationContent className="pb-0">
          {SAMPLE_MESSAGES.map((message, index) => (
            <Message key={index} from={message.from}>
              {message.from === "assistant" ? <MessageAvatar>AI</MessageAvatar> : null}
              <MessageContent>{message.text}</MessageContent>
            </Message>
          ))}
          {/* In-flow spacer — the sole bottom reservation (see story doc). */}
          <div
            aria-hidden="true"
            className="shrink-0"
            style={{ height: "calc(var(--composer-h, 13rem) + 1rem)" }}
          />
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <div ref={composerRef} className="pointer-events-none absolute inset-x-0 bottom-0 px-3 pb-3">
        <div className="pointer-events-auto mx-auto flex w-full max-w-3xl flex-col gap-2">
          <button
            type="button"
            onClick={() => setTall((current) => !current)}
            className="self-start rounded-md border border-hairline bg-bg-elev px-2 py-1 text-xs text-fg-dim hover:bg-surface-2 hover:text-fg"
          >
            {tall ? "Shrink composer" : "Grow composer"}
          </button>
          <div className="rounded-md border border-hairline bg-bg-elev p-3 text-sm text-fg-mute">
            {tall ? (
              <div className="space-y-2">
                <p>This composer is now several lines tall, like a multi-line draft.</p>
                <p>The reserved spacer grows with it, so the last message stays visible.</p>
                <p>Bottom stays flush — no dead gap above this box.</p>
              </div>
            ) : (
              <p>Single-line composer. Toggle to grow it.</p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

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
