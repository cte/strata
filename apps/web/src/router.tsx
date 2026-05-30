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
import {
  Activity,
  BookOpen,
  Database,
  GitPullRequest,
  Inbox,
  ListTodo,
  MessageSquare,
  Network,
  Search,
  Workflow,
} from "lucide-react";

import type * as React from "react";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { ChatSessionListBody, useDeleteChatSession } from "@/components/chat-session-list";
import { CommandDialog, CommandInput, CommandList } from "@/components/ui/command";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { WebAuthGate, WebAuthLogoutButton } from "@/components/web-auth-gate";
import { useLocalStorageState } from "@/hooks/use-local-storage-state";
import { readLastChatSessionId } from "@/lib/chatLastSession";
import { chatRunsStore } from "@/lib/chatRunsStore";
import { useChatSessions } from "@/lib/useChatSessions";
import { ActionsPage } from "@/routes/actions";
import { ActivityPage } from "@/routes/activity";
import { ChatPage } from "@/routes/chat";
import { ConnectorsPage } from "@/routes/connectors";
import { ConnectorsGranolaPage } from "@/routes/connectors-granola";
import { ConnectorsNotionPage } from "@/routes/connectors-notion";
import { ConnectorsSlackPage } from "@/routes/connectors-slack";
import { RetrievalIndexPage } from "@/routes/retrieval-index";
import { ReviewPage } from "@/routes/review";
import { RoutinesPage } from "@/routes/routines";
import { SettingsMcpsPage } from "@/routes/settings-mcps";

import { WikiPage } from "@/routes/wiki";

const SIDEBAR_COLLAPSED_STORAGE_KEY = "strata:sidebar:collapsed";
const noopOpenChatSessionCommandPalette = () => {};

const ChatSessionCommandPaletteContext = createContext<() => void>(
  noopOpenChatSessionCommandPalette,
);

function useOpenChatSessionCommandPalette(): () => void {
  return useContext(ChatSessionCommandPaletteContext);
}

function RootLayout(): React.ReactElement {
  const queryClient = useQueryClient();
  const [sidebarCollapsed, setSidebarCollapsed] = useLocalStorageState(
    SIDEBAR_COLLAPSED_STORAGE_KEY,
    true,
  );
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const openCommandPalette = useCallback(() => {
    setCommandPaletteOpen(true);
  }, []);

  // Give the shared run store a query client so background-discovered runs can
  // refresh the sessions list, regardless of whether ChatPage is mounted.
  useEffect(() => {
    chatRunsStore.setQueryClient(queryClient);
  }, [queryClient]);

  const handleSidebarOpenChange = useCallback(
    (open: boolean) => {
      setSidebarCollapsed(!open);
    },
    [setSidebarCollapsed],
  );

  return (
    <WebAuthGate>
      <ChatSessionCommandPaletteContext.Provider value={openCommandPalette}>
        <SidebarProvider
          open={!sidebarCollapsed}
          onOpenChange={handleSidebarOpenChange}
          style={{ "--sidebar-width": "13rem" } as React.CSSProperties}
        >
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
    </WebAuthGate>
  );
}

function AppSidebar(): React.ReactElement {
  return (
    <Sidebar collapsible="icon" className="border-r border-hairline">
      <SidebarContent className="gap-0 pt-2">
        <SidebarGroup>
          <SidebarGroupLabel>Work</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <ChatNavItem />
              <NavItem to="/actions" label="Action Items" icon={ListTodo} />
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Knowledge Base</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <NavItem to="/wiki" label="Wiki" icon={BookOpen} />
              <NavItem to="/index" label="Index" icon={Database} />
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Operations</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <NavItem to="/activity" label="Activity" icon={Activity} />
              <NavItem to="/routines" label="Routines" icon={Workflow} />
              <NavItem to="/review" label="Review" icon={Inbox} />
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Connections</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <NavItem to="/connectors" label="Connectors" icon={GitPullRequest} />
              <NavItem to="/mcps" label="MCP" icon={Network} />
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarRail />
    </Sidebar>
  );
}

function NavItem({
  to,
  label,
  icon: Icon,
}: {
  to:
    | "/activity"
    | "/actions"
    | "/connectors"
    | "/index"
    | "/mcps"
    | "/review"
    | "/routines"
    | "/wiki";

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
        className="group/nav rounded-md text-sm font-medium tracking-tight text-fg-dim data-[active=true]:bg-surface-2 data-[active=true]:text-fg hover:bg-surface-2 hover:text-fg"
      >
        <Link to={to}>
          <Icon size={14} strokeWidth={1.75} />
          <span>{label}</span>
          {isActive ? (
            <span
              aria-hidden="true"
              className="ml-auto h-1.5 w-1.5 rounded-full bg-accent group-data-[collapsible=icon]:hidden"
            />
          ) : null}
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

function ChatNavItem(): React.ReactElement {
  const navigate = useNavigate();
  const matchRoute = useMatchRoute();
  const isActive = !!matchRoute({ to: "/" }) || !!matchRoute({ to: "/chat", fuzzy: true });
  const { isMobile, setOpenMobile } = useSidebar();
  const openCommandPalette = useOpenChatSessionCommandPalette();

  const closeMobileSidebar = useCallback(() => {
    if (isMobile) {
      setOpenMobile(false);
    }
  }, [isMobile, setOpenMobile]);

  const handleOpenSearch = useCallback(() => {
    closeMobileSidebar();
    openCommandPalette();
  }, [closeMobileSidebar, openCommandPalette]);

  const handleOpenChat = useCallback(
    (event: React.MouseEvent<HTMLAnchorElement>) => {
      closeMobileSidebar();
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }
      const lastSessionId = readLastChatSessionId();
      if (lastSessionId === null) {
        return;
      }
      event.preventDefault();
      void navigate({ to: "/chat/$sessionId", params: { sessionId: lastSessionId } });
    },
    [closeMobileSidebar, navigate],
  );

  return (
    <SidebarMenuItem>
      <div className="relative">
        <SidebarMenuButton
          asChild
          isActive={isActive}
          tooltip="Chat"
          className="group/nav rounded-md text-sm font-medium tracking-tight text-fg-dim data-[active=true]:bg-surface-2 data-[active=true]:text-fg hover:bg-surface-2 hover:text-fg"
        >
          <Link to="/chat" onClick={handleOpenChat}>
            <MessageSquare size={14} strokeWidth={1.75} />
            <span>Chat</span>
          </Link>
        </SidebarMenuButton>
        <div className="pointer-events-none absolute inset-y-0 right-1.5 flex items-center gap-1.5 group-data-[collapsible=icon]:hidden">
          <button
            type="button"
            onClick={handleOpenSearch}
            aria-label="Search sessions"
            title="Search sessions (⌘K)"
            className="pointer-events-auto flex h-6 items-center gap-1 rounded px-1.5 text-fg-mute transition-[color,background-color] duration-150 hover:bg-bg-elev hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <kbd className="pointer-events-none rounded border border-hairline px-1 py-px font-mono text-2xs leading-none tracking-tight text-fg-mute">
              ⌘K
            </kbd>
            <Search size={13} strokeWidth={1.75} />
          </button>
          {isActive ? (
            <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-accent" />
          ) : null}
        </div>
      </div>
    </SidebarMenuItem>
  );
}

function ChatSessionCommandPalette({
  open,
  setOpen,
}: {
  open: boolean;
  setOpen: React.Dispatch<React.SetStateAction<boolean>>;
}): React.ReactElement {
  const navigate = useNavigate();
  const { searchQuery, setSearchQuery, sessions, isLoaded, error } = useChatSessions();
  const handleDeleteSession = useDeleteChatSession();

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
    [navigate, setOpen, setSearchQuery],
  );

  return (
    <CommandDialog
      commandProps={{ shouldFilter: false }}
      open={open}
      onOpenChange={setOpen}
      title="Chat session picker"
    >
      <CommandInput
        value={searchQuery}
        onValueChange={setSearchQuery}
        placeholder="Search chat sessions..."
      />
      <CommandList className="max-h-[min(420px,70dvh)]">
        <ChatSessionListBody
          sessions={sessions}
          isLoaded={isLoaded}
          error={Boolean(error)}
          onSelect={handleSelectSession}
          onDelete={handleDeleteSession}
        />
      </CommandList>
    </CommandDialog>
  );
}

function TopRail(): React.ReactElement {
  return (
    <header className="sticky top-0 z-30 flex h-11 items-center justify-between border-b border-hairline bg-[color-mix(in_oklab,var(--bg)_88%,transparent)] px-4 backdrop-blur-md md:px-6">
      <div className="flex items-center gap-3">
        <SidebarTrigger className="!h-6 !w-6 text-fg-dim hover:bg-surface-2 hover:text-fg [&>svg]:!size-3.5" />
      </div>
      <div className="flex items-center gap-3">
        <WebAuthLogoutButton />
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

const wikiRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/wiki",
  component: WikiPage,
});

const activityRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/activity",
  component: ActivityPage,
});

const actionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/actions",
  component: ActionsPage,
});

const reviewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/review",
  component: ReviewPage,
});

const routinesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/routines",
  component: RoutinesPage,
});

const retrievalIndexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/index",
  component: RetrievalIndexPage,
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

const mcpsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/mcps",
  component: SettingsMcpsPage,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  chatRoute,
  chatSessionRoute,
  activityRoute,
  actionsRoute,
  wikiRoute,
  reviewRoute,
  routinesRoute,
  retrievalIndexRoute,
  connectorsRoute,
  connectorsNotionRoute,
  connectorsGranolaRoute,
  connectorsSlackRoute,
  mcpsRoute,
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
