"use client";

import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";
import { math } from "@streamdown/math";
import { mermaid } from "@streamdown/mermaid";
import {
  CheckIcon,
  CopyIcon,
  DownloadIcon,
  ExternalLinkIcon,
  Loader2Icon,
  Maximize2Icon,
  RotateCcwIcon,
  XIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from "lucide-react";
import type { ComponentProps, HTMLAttributes } from "react";
import { memo } from "react";
import { type IconMap, Streamdown } from "streamdown";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export type MessageStatus = "streaming" | "complete" | "error";

export type MessageProps = HTMLAttributes<HTMLDivElement> & {
  from: "user" | "assistant" | "system";
  status?: MessageStatus;
};

export const Message = ({ className, from, status = "complete", ...props }: MessageProps) => (
  <article
    data-from={from}
    data-status={status}
    className={cn(
      "group/message flex w-full gap-3",
      from === "user" ? "is-user justify-end" : "is-assistant justify-start",
      className,
    )}
    {...props}
  />
);

export type MessageContentProps = HTMLAttributes<HTMLDivElement>;

export const MessageContent = ({ className, ...props }: MessageContentProps) => (
  <div
    className={cn(
      "min-w-0 max-w-[min(760px,100%)] text-[13px] leading-6",
      "group-data-[from=user]/message:rounded-md group-data-[from=user]/message:border group-data-[from=user]/message:border-[var(--accent)]/35 group-data-[from=user]/message:bg-[var(--accent-soft)] group-data-[from=user]/message:px-3.5 group-data-[from=user]/message:py-3 group-data-[from=user]/message:text-[var(--fg)]",
      "group-data-[from=user]/message:whitespace-pre-wrap group-data-[from=user]/message:break-words",
      "group-data-[from=assistant]/message:text-[var(--fg)]",
      "group-data-[status=error]/message:border-[var(--bad)]/45 group-data-[status=error]/message:bg-[var(--bad)]/[0.06]",
      className,
    )}
    {...props}
  />
);

export type MessageAvatarProps = HTMLAttributes<HTMLDivElement>;

export const MessageAvatar = ({ className, children, ...props }: MessageAvatarProps) => (
  <div
    className={cn(
      "mt-1 flex h-7 w-7 shrink-0 items-center justify-center border border-[var(--hairline-strong)] bg-[var(--surface-2)] font-mono text-[11.5px] text-[var(--fg-dim)]",
      className,
    )}
    {...props}
  >
    {children}
  </div>
);

export type MessageMetaProps = HTMLAttributes<HTMLDivElement>;

export const MessageMeta = ({ className, ...props }: MessageMetaProps) => (
  <div className={cn("label-eyebrow mb-1 text-[var(--fg-mute)]", className)} {...props} />
);

export type MessageActionsProps = ComponentProps<"div">;

export const MessageActions = ({ className, children, ...props }: MessageActionsProps) => (
  <div className={cn("mt-1.5 flex items-center gap-1", className)} {...props}>
    {children}
  </div>
);

export type MessageActionProps = ComponentProps<typeof Button> & {
  tooltip?: string;
  label?: string;
};

export const MessageAction = ({
  tooltip,
  children,
  label,
  variant = "ghost",
  size = "icon",
  className,
  ...props
}: MessageActionProps) => {
  const button = (
    <Button
      size={size}
      type="button"
      variant={variant}
      className={cn(
        "!h-6 !w-6 rounded-md border border-transparent p-0 text-[var(--fg-mute)] hover:!border-[var(--hairline)] hover:!bg-[var(--surface-2)] hover:!text-[var(--fg)] [&>svg]:!size-[13px]",
        className,
      )}
      {...props}
    >
      {children}
      <span className="sr-only">{label || tooltip}</span>
    </Button>
  );

  if (!tooltip) {
    return button;
  }
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent>
          <p>{tooltip}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

export type MessageResponseProps = ComponentProps<typeof Streamdown>;

const streamdownPlugins = { cjk, code, math, mermaid };
const streamdownIcons = {
  CheckIcon,
  CopyIcon,
  DownloadIcon,
  ExternalLinkIcon,
  Loader2Icon,
  Maximize2Icon,
  RotateCcwIcon,
  XIcon,
  ZoomInIcon,
  ZoomOutIcon,
} satisfies Partial<IconMap>;

export const MessageResponse = memo(
  ({ className, ...props }: MessageResponseProps) => (
    <Streamdown
      className={cn(
        "size-full text-[13px] leading-6 [&_a]:text-[var(--accent)] [&_a]:underline [&_a]:underline-offset-2 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
        className,
      )}
      icons={streamdownIcons}
      plugins={streamdownPlugins}
      {...props}
    />
  ),
  (prev, next) => prev.children === next.children && prev.isAnimating === next.isAnimating,
);

MessageResponse.displayName = "MessageResponse";
