"use client";

import { ArrowDown } from "lucide-react";
import type { ComponentProps } from "react";
import { useCallback } from "react";
import { StickToBottom, useStickToBottomContext } from "use-stick-to-bottom";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { cn } from "@/lib/utils";

export type ConversationProps = ComponentProps<typeof StickToBottom>;

export const Conversation = ({ className, ...props }: ConversationProps) => (
  <StickToBottom
    className={cn("relative flex-1 overflow-hidden bg-bg", className)}
    initial="instant"
    resize="instant"
    role="log"
    {...props}
  />
);

export type ConversationContentProps = ComponentProps<typeof StickToBottom.Content>;

export const ConversationContent = ({ className, ...props }: ConversationContentProps) => (
  <StickToBottom.Content
    className={cn(
      "mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 pt-5 pb-32 md:px-6",
      className,
    )}
    {...props}
  />
);

export type ConversationEmptyStateProps = ComponentProps<"div"> & {
  title?: string;
  description?: string;
  icon?: React.ReactNode;
};

export const ConversationEmptyState = ({
  className,
  title = "No messages yet",
  description,
  icon,
  children,
  ...props
}: ConversationEmptyStateProps) => (
  <Empty
    className={cn("min-h-[280px] border-0 bg-transparent px-4 py-10 text-center", className)}
    {...props}
  >
    {children ?? (
      <EmptyHeader>
        {icon ? <EmptyMedia className="mb-1 text-fg-mute">{icon}</EmptyMedia> : null}
        <EmptyTitle className="text-sm font-medium tracking-tight text-fg">{title}</EmptyTitle>
        {description ? (
          <EmptyDescription className="text-xs leading-normal text-fg-mute">
            {description}
          </EmptyDescription>
        ) : null}
      </EmptyHeader>
    )}
  </Empty>
);

export type ConversationScrollButtonProps = ComponentProps<typeof Button>;

export const ConversationScrollButton = ({
  className,
  ...props
}: ConversationScrollButtonProps) => {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext();

  const handleScrollToBottom = useCallback(() => {
    scrollToBottom();
  }, [scrollToBottom]);

  if (isAtBottom) {
    return null;
  }
  return (
    <Button
      type="button"
      variant="secondary"
      size="icon"
      onClick={handleScrollToBottom}
      aria-label="Scroll to latest"
      className={cn(
        "absolute bottom-24 left-1/2 z-10 h-8 w-8 -translate-x-1/2 rounded-full border-hairline-strong bg-bg-elev text-fg-dim shadow-md shadow-black/30 hover:bg-surface-2 hover:text-fg [&>svg]:!size-3.5",
        className,
      )}
      {...props}
    >
      <ArrowDown size={14} strokeWidth={1.75} />
    </Button>
  );
};
