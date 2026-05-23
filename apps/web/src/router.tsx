import { useQueryClient } from "@tanstack/react-query";
import {
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  Outlet,
  useMatchRoute,
  useNavigate,
} from "@tanstack/react-router";
import { GitPullRequest, LoaderCircle, MessageSquare, Plus, Search, Trash2 } from "lucide-react";
import type * as React from "react";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { useLocalStorageState } from "@/hooks/use-local-storage-state";
import {
  type ChatSessionDeleteResult,
  type ChatSessionSummary,
  deleteChatSession,
} from "@/lib/api";
import { useChatSessions } from "@/lib/useChatSessions";
import { cn } from "@/lib/utils";
import { ChatPage } from "@/routes/chat";
import { ConnectorsPage } from "@/routes/connectors";
import { ConnectorsGranolaPage } from "@/routes/connectors-granola";
import { ConnectorsNotionPage } from "@/routes/connectors-notion";
import { ConnectorsSlackPage } from "@/routes/connectors-slack";

const SIDEBAR_COLLAPSED_STORAGE_KEY = "strata:sidebar:collapsed";
const noopOpenChatSessionCommandPalette = () => {};

const ChatSessionCommandPaletteContext = createContext<() => void>(
  noopOpenChatSessionCommandPalette,
);

function useOpenChatSessionCommandPalette(): () => void {
  return useContext(ChatSessionCommandPaletteContext);
}

function RootLayout(): React.ReactElement {
  const [sidebarCollapsed, setSidebarCollapsed] = useLocalStorageState(
    SIDEBAR_COLLAPSED_STORAGE_KEY,
    true,
  );
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const openCommandPalette = useCallback(() => {
    setCommandPaletteOpen(true);
  }, []);

  const handleSidebarOpenChange = useCallback(
    (open: boolean) => {
      setSidebarCollapsed(!open);
    },
    [setSidebarCollapsed],
  );

  return (
    <ChatSessionCommandPaletteContext.Provider value={openCommandPalette}>
      <SidebarProvider open={!sidebarCollapsed} onOpenChange={handleSidebarOpenChange}>
        <AppSidebar />
        <ChatSessionCommandPalette open={commandPaletteOpen} setOpen={setCommandPaletteOpen} />
        <SidebarInset>
          <TopRail />
          <main className="min-w-0 px-6 py-8 md:px-10 md:py-10">
            <Outlet />
          </main>
        </SidebarInset>
      </SidebarProvider>
    </ChatSessionCommandPaletteContext.Provider>
  );
}

function AppSidebar(): React.ReactElement {
  return (
    <Sidebar collapsible="icon" className="border-r border-[var(--hairline)]">
      <SidebarContent className="gap-0 pt-2">
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <ChatNavItem />
              <NavItem to="/connectors" label="Connectors" icon={GitPullRequest} />
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="p-0">
        <SidebarGroup className="p-2">
          <SidebarGroupContent>
            <SidebarMenu>
              <NewChatItem />
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}

function NavItem({
  to,
  label,
  icon: Icon,
}: {
  to: "/connectors";
  label: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
}): React.ReactElement {
  const matchRoute = useMatchRoute();
  // /connectors should stay highlighted on /connectors/<connector-name> too.
  const isActive = !!matchRoute({ to, fuzzy: true });

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        isActive={isActive}
        tooltip={label}
        className="group/nav rounded-md text-[13px] font-medium tracking-tight text-[var(--fg-dim)] data-[active=true]:bg-[var(--surface-2)] data-[active=true]:text-[var(--fg)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)]"
      >
        <Link to={to}>
          <Icon size={14} strokeWidth={1.75} />
          <span>{label}</span>
          {isActive ? (
            <span
              aria-hidden="true"
              className="ml-auto h-1.5 w-1.5 rounded-full bg-[var(--accent)] group-data-[collapsible=icon]:hidden"
            />
          ) : null}
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

function ChatNavItem(): React.ReactElement {
  const matchRoute = useMatchRoute();
  const navigate = useNavigate();
  const chatSessionMatch = matchRoute({ to: "/chat/$sessionId" }) as false | { sessionId?: string };
  const isActive = !!matchRoute({ to: "/" }) || !!matchRoute({ to: "/chat", fuzzy: true });
  const { isMobile, setOpenMobile } = useSidebar();
  const queryClient = useQueryClient();
  const openCommandPalette = useOpenChatSessionCommandPalette();

  const activeSessionId = chatSessionMatch ? (chatSessionMatch.sessionId ?? null) : null;
  const { sessions, isLoaded } = useChatSessions();

  const closeMobileSidebar = useCallback(() => {
    if (isMobile) {
      setOpenMobile(false);
    }
  }, [isMobile, setOpenMobile]);

  const handleOpenSearch = useCallback(() => {
    closeMobileSidebar();
    openCommandPalette();
  }, [closeMobileSidebar, openCommandPalette]);

  const handleDeleteSession = useCallback(
    async (session: ChatSessionSummary): Promise<ChatSessionDeleteResult> => {
      const result = await deleteChatSession(session.id);
      queryClient.removeQueries({ queryKey: ["chat", "sessions", "detail", session.id] });
      await queryClient.invalidateQueries({ queryKey: ["chat", "sessions"] });
      if (activeSessionId === session.id) {
        void navigate({ to: "/chat", replace: true });
      }
      return result;
    },
    [activeSessionId, navigate, queryClient],
  );

  return (
    <SidebarMenuItem>
      <div className="relative">
        <SidebarMenuButton
          asChild
          isActive={isActive}
          tooltip="Chat"
          className="group/nav rounded-md text-[13px] font-medium tracking-tight text-[var(--fg-dim)] data-[active=true]:bg-[var(--surface-2)] data-[active=true]:text-[var(--fg)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)]"
        >
          <Link to="/chat" onClick={closeMobileSidebar}>
            <MessageSquare size={14} strokeWidth={1.75} />
            <span>Chat</span>
          </Link>
        </SidebarMenuButton>
        <div className="pointer-events-none absolute inset-y-0 right-1 flex items-center gap-0.5 group-data-[collapsible=icon]:hidden">
          <button
            type="button"
            onClick={handleOpenSearch}
            aria-label="Search sessions"
            title="Search sessions"
            className="pointer-events-auto flex h-6 w-6 items-center justify-center rounded text-[var(--fg-mute)] transition-[color,background-color] duration-150 hover:bg-[var(--bg-elev)] hover:text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          >
            <Search size={13} strokeWidth={1.75} />
          </button>
        </div>
      </div>

      {isActive ? (
        <ChatSessionSubMenu
          activeSessionId={activeSessionId}
          onDeleteSession={handleDeleteSession}
          onNavigate={closeMobileSidebar}
          sessions={sessions}
          sessionsLoaded={isLoaded}
        />
      ) : null}
    </SidebarMenuItem>
  );
}

/**
 * "New chat" footer item. Shown in both expanded and collapsed sidebars.
 */
function NewChatItem(): React.ReactElement {
  const { isMobile, setOpenMobile } = useSidebar();
  const closeMobileSidebar = useCallback(() => {
    if (isMobile) {
      setOpenMobile(false);
    }
  }, [isMobile, setOpenMobile]);
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        tooltip="New chat"
        className="rounded-md text-[var(--fg-dim)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)]"
      >
        <Link to="/" search={{}} onClick={closeMobileSidebar}>
          <Plus size={14} strokeWidth={1.75} />
          <span>New chat</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

function ChatSessionSubMenu({
  activeSessionId,
  onDeleteSession,
  onNavigate,
  sessions,
  sessionsLoaded,
}: {
  activeSessionId: string | null;
  onDeleteSession(session: ChatSessionSummary): Promise<ChatSessionDeleteResult>;
  onNavigate(): void;
  sessions: ChatSessionSummary[];
  sessionsLoaded: boolean;
}): React.ReactElement {
  return (
    <div className="mt-1 flex flex-col gap-1.5 group-data-[collapsible=icon]:hidden">
      <SidebarMenuSub className="max-h-[min(420px,calc(100dvh-22rem))] overflow-y-auto py-1">
        {!sessionsLoaded ? (
          <SessionRowSkeleton />
        ) : sessions.length === 0 ? (
          <p className="px-2 py-2 text-[11.5px] text-[var(--fg-mute)]">No sessions.</p>
        ) : (
          sessions.map((session) => (
            <ChatSessionSubRow
              key={session.id}
              active={session.id === activeSessionId}
              onDelete={onDeleteSession}
              onNavigate={onNavigate}
              session={session}
            />
          ))
        )}
      </SidebarMenuSub>
    </div>
  );
}

function ChatSessionSubRow({
  active,
  onDelete,
  onNavigate,
  session,
}: {
  active: boolean;
  onDelete(session: ChatSessionSummary): Promise<ChatSessionDeleteResult>;
  onNavigate(): void;
  session: ChatSessionSummary;
}): React.ReactElement {
  const title = sanitizeDisplayText(session.title);
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const canDelete = session.status !== "running";

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (deleting) {
        return;
      }
      setOpen(next);
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
    <SidebarMenuSubItem>
      <div className="group/session-row relative min-w-0">
        <SidebarMenuSubButton
          asChild
          isActive={active}
          size="sm"
          className="h-auto items-start gap-2 py-1.5 data-[active=true]:bg-[var(--accent-soft)] data-[active=true]:text-[var(--fg)]"
        >
          <Link to="/chat/$sessionId" params={{ sessionId: session.id }} onClick={onNavigate}>
            <span
              className={cn(
                "mt-1 h-1.5 w-1.5 shrink-0 rounded-full",
                statusDotClass(session.status),
              )}
            />
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-[12px] tracking-tight text-[var(--fg)]">{title}</span>
              <span className="font-mono text-[11.5px] text-[var(--fg-mute)]">
                {formatSessionTime(session.startedAt)}
              </span>
            </span>
          </Link>
        </SidebarMenuSubButton>
        {active ? null : (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute top-px right-px bottom-px w-10 rounded-r-md bg-gradient-to-l from-[var(--surface-2)] via-[var(--surface-2)] to-transparent opacity-0 transition-opacity duration-150 group-hover/session-row:opacity-100"
          />
        )}
        <Popover open={open} onOpenChange={handleOpenChange}>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={`Delete ${title}`}
              title={canDelete ? "Delete session" : "Cannot delete a running session"}
              disabled={!canDelete}
              className={cn(
                "absolute top-1.5 right-1 flex h-6 w-6 items-center justify-center rounded text-[var(--fg-mute)] opacity-0 transition-[opacity,color,background-color] duration-150 hover:bg-[var(--bad)]/10 hover:text-[var(--bad)] focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:pointer-events-none disabled:opacity-30 group-hover/session-row:opacity-100",
                open && "bg-[var(--bad)]/10 text-[var(--bad)] opacity-100",
              )}
            >
              <Trash2 size={13} strokeWidth={1.75} />
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
            className="w-64 rounded-lg border border-[var(--hairline)] bg-[var(--bg-elev)] p-3 text-[var(--fg)] shadow-lg"
          >
            <ChatSessionDeleteConfirm
              title={title}
              deleting={deleting}
              error={deleteError}
              onCancel={() => handleOpenChange(false)}
              onConfirm={confirmDelete}
            />
          </PopoverContent>
        </Popover>
      </div>
    </SidebarMenuSubItem>
  );
}

function ChatSessionDeleteConfirm({
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
        <p className="text-[13px] font-medium tracking-tight text-[var(--fg)]">Delete session?</p>
        <p className="line-clamp-2 text-[12px] leading-snug text-[var(--fg-dim)]">
          <span className="text-[var(--fg)]">{title}</span>
          <span> will be permanently removed.</span>
        </p>
      </div>
      {error ? (
        <p className="rounded-sm bg-[var(--bad)]/10 px-2 py-1 font-mono text-[10.5px] text-[var(--bad)]">
          {error}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={deleting}
          className="h-7 rounded-md border border-[var(--hairline-strong)] bg-transparent px-2.5 text-[11.5px] font-medium text-[var(--fg-dim)] transition-colors duration-150 hover:bg-[var(--surface-2)] hover:text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          autoFocus
          onClick={onConfirm}
          disabled={deleting}
          className="flex h-7 items-center gap-1.5 rounded-md bg-[var(--bad)] px-2.5 text-[11.5px] font-medium text-white transition-[background-color,opacity] duration-150 hover:bg-[var(--bad)]/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--bad)]/40 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {deleting ? <LoaderCircle size={13} strokeWidth={2} className="animate-spin" /> : null}
          {deleting ? "Deleting" : "Delete"}
        </button>
      </div>
    </div>
  );
}

function SessionRowSkeleton(): React.ReactElement {
  return (
    <li className="flex items-center justify-center px-2 py-3 text-[var(--fg-mute)]">
      <LoaderCircle size={13} strokeWidth={1.75} className="animate-spin" />
    </li>
  );
}

function sanitizeDisplayText(value: string): string {
  const sanitized = value
    .replace(
      /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][\s\S]*?(?:\x07|\x1b\\)|[PX^_][\s\S]*?\x1b\\|[@-Z\\-_])/g,
      "",
    )
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "");
  return sanitized.trim() === "" ? "Untitled session" : sanitized;
}

function formatSessionTime(value: string): string {
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
      return "bg-[var(--good)]";
    case "failed":
      return "bg-[var(--bad)]";
    case "interrupted":
      return "bg-[var(--warn)]";
    case "running":
      return "bg-[var(--accent)]";
  }
}

function ChatSessionCommandPalette({
  open,
  setOpen,
}: {
  open: boolean;
  setOpen: React.Dispatch<React.SetStateAction<boolean>>;
}): React.ReactElement {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const matchRoute = useMatchRoute();
  const chatSessionMatch = matchRoute({ to: "/chat/$sessionId" }) as false | { sessionId?: string };
  const activeSessionId = chatSessionMatch ? (chatSessionMatch.sessionId ?? null) : null;
  const { searchQuery, setSearchQuery, sessions, isLoaded, error } = useChatSessions();

  const handleDeleteSession = useCallback(
    async (session: ChatSessionSummary): Promise<ChatSessionDeleteResult> => {
      const result = await deleteChatSession(session.id);
      queryClient.removeQueries({ queryKey: ["chat", "sessions", "detail", session.id] });
      await queryClient.invalidateQueries({ queryKey: ["chat", "sessions"] });
      if (activeSessionId === session.id) {
        void navigate({ to: "/chat", replace: true });
      }
      return result;
    },
    [activeSessionId, navigate, queryClient],
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "k" || (!event.metaKey && !event.ctrlKey)) {
        return;
      }
      event.preventDefault();
      setOpen((current) => !current);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [setOpen]);

  useEffect(() => {
    if (!open) {
      setSearchQuery("");
    }
  }, [open, setSearchQuery]);

  const handleSelectSession = useCallback(
    (sessionId: string) => {
      setOpen(false);
      setSearchQuery("");
      void navigate({ to: "/chat/$sessionId", params: { sessionId } });
    },
    [navigate, setSearchQuery],
  );

  return (
    <CommandDialog open={open} onOpenChange={setOpen} title="Chat session picker">
      <CommandInput
        value={searchQuery}
        onValueChange={setSearchQuery}
        placeholder="Search chat sessions..."
      />
      <CommandList className="max-h-[min(420px,70dvh)]">
        {!isLoaded ? (
          <CommandGroup heading="Sessions">
            <CommandItem disabled>
              <LoaderCircle className="animate-spin" />
              <span>Loading sessions...</span>
            </CommandItem>
          </CommandGroup>
        ) : error ? (
          <CommandGroup heading="Sessions">
            <CommandItem disabled>
              <span>Could not load sessions.</span>
            </CommandItem>
          </CommandGroup>
        ) : sessions.length === 0 ? (
          <CommandEmpty>No sessions found.</CommandEmpty>
        ) : (
          <CommandGroup heading="Sessions">
            {sessions.map((session) => (
              <SessionCommandRow
                key={session.id}
                session={session}
                onSelect={handleSelectSession}
                onDelete={handleDeleteSession}
              />
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  );
}

function SessionCommandRow({
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
      <span
        aria-hidden="true"
        className={cn("mt-2 size-1.5 shrink-0 rounded-full", statusDotClass(session.status))}
      />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-[13px] font-medium tracking-tight">{title}</span>
        <span className="font-mono text-[11.5px] leading-5 text-black/50 dark:text-white/50">
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
              "absolute top-2 right-2 flex h-6 w-6 items-center justify-center rounded text-[var(--fg-mute)] opacity-0 transition-[opacity,color,background-color] duration-150 hover:bg-[var(--bad)]/10 hover:text-[var(--bad)] focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:pointer-events-none disabled:opacity-30 group-hover/session-command:opacity-100 group-data-[selected=true]/session-command:opacity-100",
              deleteOpen && "bg-[var(--bad)]/10 text-[var(--bad)] opacity-100",
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
          className="w-64 rounded-lg border border-[var(--hairline)] bg-[var(--bg-elev)] p-3 text-[var(--fg)] shadow-lg"
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

function TopRail(): React.ReactElement {
  return (
    <header className="sticky top-0 z-30 flex h-11 items-center justify-between border-b border-[var(--hairline)] bg-[color-mix(in_oklab,var(--bg)_88%,transparent)] px-4 backdrop-blur-md md:px-6">
      <div className="flex items-center gap-3">
        <SidebarTrigger className="!h-6 !w-6 text-[var(--fg-dim)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)] [&>svg]:!size-3.5" />
      </div>
      <div className="flex items-center gap-4">
        <ThemeToggle />
      </div>
    </header>
  );
}

const rootRoute = createRootRoute({
  component: RootLayout,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: ChatPage,
  validateSearch: (search): { session?: string } => ({
    ...(typeof search.session === "string" && search.session.length > 0
      ? { session: search.session }
      : {}),
  }),
});

const chatRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/chat",
  component: ChatPage,
});

const chatSessionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/chat/$sessionId",
  component: ChatPage,
});

const connectorsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/connectors",
  component: ConnectorsPage,
});

const connectorsNotionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/connectors/notion",
  component: ConnectorsNotionPage,
});

const connectorsGranolaRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/connectors/granola",
  component: ConnectorsGranolaPage,
});

const connectorsSlackRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/connectors/slack",
  component: ConnectorsSlackPage,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  chatRoute,
  chatSessionRoute,
  connectorsRoute,
  connectorsNotionRoute,
  connectorsGranolaRoute,
  connectorsSlackRoute,
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
