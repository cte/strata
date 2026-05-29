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
  CalendarClock,
  FileCheck2,
  GitPullRequest,
  ListTodo,
  MessageSquare,
  Network,
  Search,
  Tags,
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
import { useLocalStorageState } from "@/hooks/use-local-storage-state";
import { chatRunsStore } from "@/lib/chatRunsStore";
import { useChatSessions } from "@/lib/useChatSessions";
import { ActionsPage } from "@/routes/actions";
import { ActivityPage } from "@/routes/activity";
import { ChatPage } from "@/routes/chat";
import { ConnectorsPage } from "@/routes/connectors";
import { ConnectorsGranolaPage } from "@/routes/connectors-granola";
import { ConnectorsNotionPage } from "@/routes/connectors-notion";
import { ConnectorsSlackPage } from "@/routes/connectors-slack";
import { IngestTaxonomyPage } from "@/routes/ingest-taxonomy";
import { ProposalsPage } from "@/routes/proposals";
import { SchedulesPage } from "@/routes/schedules";
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
              <NavItem to="/activity" label="Activity" icon={Activity} />
              <NavItem to="/actions" label="Actions" icon={ListTodo} />
              <NavItem to="/wiki" label="Wiki" icon={BookOpen} />
              <NavItem to="/proposals" label="Proposals" icon={FileCheck2} />
              <NavItem to="/ingest-taxonomy" label="Taxonomy" icon={Tags} />
              <NavItem to="/schedules" label="Schedules" icon={CalendarClock} />
              <NavItem to="/connectors" label="Connectors" icon={GitPullRequest} />
              <NavItem to="/mcps" label="MCP servers" icon={Network} />
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
    | "/ingest-taxonomy"
    | "/mcps"
    | "/proposals"
    | "/schedules"
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
        <div className="pointer-events-none absolute inset-y-0 right-1.5 flex items-center gap-1.5 group-data-[collapsible=icon]:hidden">
          <button
            type="button"
            onClick={handleOpenSearch}
            aria-label="Search sessions"
            title="Search sessions (⌘K)"
            className="pointer-events-auto flex h-6 items-center gap-1 rounded px-1.5 text-[var(--fg-mute)] transition-[color,background-color] duration-150 hover:bg-[var(--bg-elev)] hover:text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          >
            <kbd className="pointer-events-none rounded border border-[var(--hairline)] px-1 py-px font-mono text-[9px] leading-none tracking-tight text-[var(--fg-mute)]">
              ⌘K
            </kbd>
            <Search size={13} strokeWidth={1.75} />
          </button>
          {isActive ? (
            <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
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

const proposalsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/proposals",
  component: ProposalsPage,
});

const ingestTaxonomyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/ingest-taxonomy",
  component: IngestTaxonomyPage,
});

const schedulesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/schedules",
  component: SchedulesPage,
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
  proposalsRoute,
  ingestTaxonomyRoute,
  schedulesRoute,
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
