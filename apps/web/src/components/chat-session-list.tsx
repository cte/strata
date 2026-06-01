import { useQueryClient } from "@tanstack/react-query";
import { useMatchRoute, useNavigate } from "@tanstack/react-router";
import { LoaderCircle, Trash2 } from "lucide-react";
import type * as React from "react";
import { useCallback, useState } from "react";
import { CommandEmpty, CommandGroup, CommandItem } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  type ChatSessionDeleteResult,
  type ChatSessionSummary,
  deleteChatSession,
} from "@/lib/api";
import { clearLastChatSessionId } from "@/lib/chatLastSession";
import { CHAT_NEW_TAB_KEY, useChatPinnedTabsStore } from "@/lib/chatPinnedTabs";
import { useRunningSessionIds } from "@/lib/useChatRun";
import { cn } from "@/lib/utils";

/**
 * Shared chat-session list used by both the ⌘K palette and the inline
 * "recent chats" panel shown on a fresh chat surface. Rows are cmdk
 * `CommandItem`s, so this body must render inside a `Command`/`CommandList`.
 */
export function ChatSessionListBody({
  sessions,
  isLoaded,
  error,
  onSelect,
  onDelete,
}: {
  sessions: ChatSessionSummary[];
  isLoaded: boolean;
  error: boolean;
  onSelect(sessionId: string): void;
  onDelete(session: ChatSessionSummary): Promise<ChatSessionDeleteResult>;
}): React.ReactElement {
  if (!isLoaded) {
    return (
      <CommandGroup>
        <CommandItem disabled>
          <LoaderCircle className="animate-spin" />
          <span>Loading sessions...</span>
        </CommandItem>
      </CommandGroup>
    );
  }
  if (error) {
    return (
      <CommandGroup>
        <CommandItem disabled>
          <span>Could not load sessions.</span>
        </CommandItem>
      </CommandGroup>
    );
  }
  if (sessions.length === 0) {
    return <CommandEmpty>No sessions found.</CommandEmpty>;
  }
  return (
    <CommandGroup>
      {sessions.map((session) => (
        <SessionCommandRow
          key={session.id}
          session={session}
          onSelect={onSelect}
          onDelete={onDelete}
        />
      ))}
    </CommandGroup>
  );
}

/**
 * Deletes a chat session, prunes its cached detail, refreshes the sessions
 * list, and navigates away from it if it is the one currently open.
 */
export function useDeleteChatSession(): (
  session: ChatSessionSummary,
) => Promise<ChatSessionDeleteResult> {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const matchRoute = useMatchRoute();
  const removePinnedSession = useChatPinnedTabsStore((state) => state.removeSession);
  return useCallback(
    async (session: ChatSessionSummary): Promise<ChatSessionDeleteResult> => {
      const result = await deleteChatSession(session.id);
      clearLastChatSessionId(session.id);
      queryClient.removeQueries({ queryKey: ["chat", "sessions", "detail", session.id] });
      await queryClient.invalidateQueries({ queryKey: ["chat", "sessions"] });
      const match = matchRoute({ to: "/chat/$sessionId" }) as false | { sessionId?: string };
      const activeSessionId = match ? (match.sessionId ?? null) : null;
      const nextPinnedTab = removePinnedSession(session.id, activeSessionId ?? CHAT_NEW_TAB_KEY);
      if (activeSessionId === session.id) {
        if (nextPinnedTab?.sessionId === null || nextPinnedTab === null) {
          void navigate({ to: "/chat", replace: true });
        } else {
          void navigate({
            to: "/chat/$sessionId",
            params: { sessionId: nextPinnedTab.sessionId },
            replace: true,
          });
        }
      }
      return result;
    },
    [matchRoute, navigate, queryClient, removePinnedSession],
  );
}

export function SessionCommandRow({
  session,
  onSelect,
  onDelete,
}: {
  session: ChatSessionSummary;
  onSelect(sessionId: string): void;
  onDelete(session: ChatSessionSummary): Promise<ChatSessionDeleteResult>;
}): React.ReactElement {
  const title = sanitizeDisplayText(session.title);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const canDelete = session.status !== "running";

  const handleDeleteOpenChange = useCallback(
    (next: boolean) => {
      if (deleting) {
        return;
      }
      setDeleteOpen(next);
      if (!next) {
        setDeleteError(null);
      }
    },
    [deleting],
  );

  const confirmDelete = useCallback(() => {
    if (!canDelete || deleting) {
      return;
    }
    setDeleting(true);
    setDeleteError(null);
    void onDelete(session).catch((cause: unknown) => {
      setDeleteError(cause instanceof Error ? cause.message : String(cause));
      setDeleting(false);
    });
  }, [canDelete, deleting, onDelete, session]);

  return (
    <CommandItem
      value={`${title} ${session.id} ${session.status} ${formatSessionTime(session.startedAt)}`}
      onSelect={() => {
        if (deleteOpen) {
          return;
        }
        onSelect(session.id);
      }}
      className="group/session-command relative items-start gap-3 py-2.5 pr-9"
    >
      <SessionStatusDot session={session} className="mt-2 size-1.5" />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-sm font-medium tracking-tight">{title}</span>
        <span className="font-mono text-xs leading-5 text-black/50 dark:text-white/50">
          {formatSessionTime(session.startedAt)}
        </span>
      </span>
      <Popover open={deleteOpen} onOpenChange={handleDeleteOpenChange}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={`Delete ${title}`}
            title={canDelete ? "Delete session" : "Cannot delete a running session"}
            disabled={!canDelete}
            onClick={(event) => {
              // Stop the click from reaching the cmdk row (which would call
              // onSelect → navigate). Do NOT preventDefault — Radix's
              // composeEventHandlers skips the popover-open handler when the
              // event has been default-prevented.
              event.stopPropagation();
            }}
            onPointerDown={(event) => {
              // Block cmdk's pointer handling so clicking the trash does not
              // also navigate to the session via the row's onSelect.
              event.stopPropagation();
            }}
            className={cn(
              "absolute top-2 right-2 flex h-6 w-6 items-center justify-center rounded text-fg-mute opacity-0 transition-[opacity,color,background-color] duration-150 hover:bg-bad/10 hover:text-bad focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-30 group-hover/session-command:opacity-100 group-data-[selected=true]/session-command:opacity-100",
              deleteOpen && "bg-bad/10 text-bad opacity-100",
            )}
          >
            <Trash2 size={12} strokeWidth={1.75} />
          </button>
        </PopoverTrigger>
        <PopoverContent
          side="right"
          align="start"
          sideOffset={10}
          collisionPadding={12}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
          }}
          onEscapeKeyDown={(event) => {
            // Stop the cmd-k dialog from closing when popover handles Escape.
            event.stopPropagation();
          }}
          onPointerDownOutside={(event) => {
            // Stop the cmd-k dialog from treating popover-anchored clicks as
            // outside interactions that would close the dialog.
            event.stopPropagation();
          }}
          className="w-64 rounded-lg border border-hairline bg-bg-elev p-3 text-fg shadow-lg"
        >
          <ChatSessionDeleteConfirm
            title={title}
            deleting={deleting}
            error={deleteError}
            onCancel={() => handleDeleteOpenChange(false)}
            onConfirm={confirmDelete}
          />
        </PopoverContent>
      </Popover>
    </CommandItem>
  );
}

export function ChatSessionDeleteConfirm({
  title,
  deleting,
  error,
  onCancel,
  onConfirm,
}: {
  title: string;
  deleting: boolean;
  error: string | null;
  onCancel(): void;
  onConfirm(): void;
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium tracking-tight text-fg">Delete session?</p>
        <p className="line-clamp-2 text-xs leading-snug text-fg-dim">
          <span className="text-fg">{title}</span>
          <span> will be permanently removed.</span>
        </p>
      </div>
      {error ? (
        <p className="rounded-sm bg-bad/10 px-2 py-1 font-mono text-2xs text-bad">{error}</p>
      ) : null}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={deleting}
          className="h-7 rounded-md border border-hairline-strong bg-transparent px-2.5 text-xs font-medium text-fg-dim transition-colors duration-150 hover:bg-surface-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          autoFocus
          onClick={onConfirm}
          disabled={deleting}
          className="flex h-7 items-center gap-1.5 rounded-md bg-bad px-2.5 text-xs font-medium text-white transition-[background-color,opacity] duration-150 hover:bg-bad/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bad/40 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {deleting ? <LoaderCircle size={13} strokeWidth={2} className="animate-spin" /> : null}
          {deleting ? "Deleting" : "Delete"}
        </button>
      </div>
    </div>
  );
}

export function sanitizeDisplayText(value: string): string {
  const sanitized = value
    .replace(
      /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][\s\S]*?(?:\x07|\x1b\\)|[PX^_][\s\S]*?\x1b\\|[@-Z\\-_])/g,
      "",
    )
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "");
  return sanitized.trim() === "" ? "Untitled session" : sanitized;
}

export function formatSessionTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function statusDotClass(status: ChatSessionSummary["status"]): string {
  switch (status) {
    case "completed":
      return "bg-good";
    case "failed":
      return "bg-bad";
    case "interrupted":
      return "bg-warn";
    case "running":
      return "bg-accent";
  }
}

/**
 * Status dot that reflects live client-side run state in real time. A session
 * with a run streaming in any tab/view shows a pulsing accent dot immediately,
 * ahead of the sessions-list query catching up; otherwise it falls back to the
 * server-reported status.
 */
export function SessionStatusDot({
  session,
  className,
}: {
  session: ChatSessionSummary;
  className?: string;
}): React.ReactElement {
  const running = useRunningSessionIds();
  const live = running.has(session.id) || session.status === "running";
  return (
    <span
      aria-hidden="true"
      className={cn(
        "shrink-0 rounded-full",
        className,
        live ? "bg-accent text-accent dot-pulse" : statusDotClass(session.status),
      )}
    />
  );
}
