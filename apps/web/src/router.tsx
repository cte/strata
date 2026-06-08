import { useQueryClient } from "@tanstack/react-query";
import {
  createRootRoute,
  createRoute,
  createRouter,
  HeadContent,
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
  Workflow,
} from "lucide-react";

import type * as React from "react";
import { useCallback, useEffect, useState } from "react";
import { ChatSessionListBody, useDeleteChatSession } from "@/components/chat-session-list";
import { NotFound } from "@/components/not-found";
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
import { ChatSessionCommandPaletteContext } from "@/lib/chatCommandPalette";
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
const APP_TITLE = "Strata";

function pageTitle(...sections: string[]): string {
  return sections.length === 0 ? APP_TITLE : [...sections, APP_TITLE].join(" · ");
}

function titleHead(...sections: string[]): { meta: [{ title: string }] } {
  return { meta: [{ title: pageTitle(...sections) }] };
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
    <>
      <HeadContent />
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
              <div className="flex min-h-0 flex-1 flex-col">
                <Outlet />
              </div>
            </SidebarInset>
          </SidebarProvider>
        </ChatSessionCommandPaletteContext.Provider>
      </WebAuthGate>
    </>
  );
}

const navGroupLabel =
  "gap-2.5 px-2 text-2xs font-medium uppercase tracking-[0.13em] text-sidebar-foreground/40";

function NavGroupLabel({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <SidebarGroupLabel className={navGroupLabel}>
      <span className="shrink-0">{children}</span>
      <span
        aria-hidden="true"
        className="h-px flex-1 bg-sidebar-foreground/10 group-data-[collapsible=icon]:hidden"
      />
    </SidebarGroupLabel>
  );
}

function AppSidebar(): React.ReactElement {
  return (
    <Sidebar collapsible="icon" className="border-r border-hairline">
      <SidebarContent className="gap-0 pt-2">
        <SidebarGroup>
          <NavGroupLabel>Work</NavGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <ChatNavItem />
              <NavItem to="/actions" label="Action Items" icon={ListTodo} />
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <NavGroupLabel>Knowledge Base</NavGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <NavItem to="/wiki" label="Wiki" icon={BookOpen} />
              <NavItem to="/index" label="Index" icon={Database} />
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <NavGroupLabel>Operations</NavGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <NavItem to="/activity" label="Activity" icon={Activity} />
              <NavItem to="/routines" label="Routines" icon={Workflow} />
              <NavItem to="/review" label="Review" icon={Inbox} />
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <NavGroupLabel>Connections</NavGroupLabel>
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
        render={<Link to={to} />}
        isActive={isActive}
        tooltip={label}
        className="group/nav rounded-md text-sm font-medium tracking-tight text-fg-dim data-[active=true]:bg-surface-2 data-[active=true]:text-fg hover:bg-surface-2 hover:text-fg"
      >
        <Icon size={14} strokeWidth={1.75} />
        <span>{label}</span>
        {isActive ? (
          <span
            aria-hidden="true"
            className="ml-auto h-1.5 w-1.5 rounded-full bg-selection shadow-[0_0_0_3px_color-mix(in_srgb,var(--selection)_22%,transparent)] group-data-[collapsible=icon]:hidden"
          />
        ) : null}
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

function ChatNavItem(): React.ReactElement {
  const navigate = useNavigate();
  const matchRoute = useMatchRoute();
  const isActive = !!matchRoute({ to: "/" }) || !!matchRoute({ to: "/chat", fuzzy: true });
  const { isMobile, setOpenMobile } = useSidebar();

  const closeMobileSidebar = useCallback(() => {
    if (isMobile) {
      setOpenMobile(false);
    }
  }, [isMobile, setOpenMobile]);

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
      <SidebarMenuButton
        render={<Link to="/chat" onClick={handleOpenChat} />}
        isActive={isActive}
        tooltip="Chat"
        className="group/nav rounded-md text-sm font-medium tracking-tight text-fg-dim data-[active=true]:bg-surface-2 data-[active=true]:text-fg hover:bg-surface-2 hover:text-fg"
      >
        <MessageSquare size={14} strokeWidth={1.75} />
        <span>Chat</span>
        {isActive ? (
          <span
            aria-hidden="true"
            className="ml-auto h-1.5 w-1.5 rounded-full bg-selection shadow-[0_0_0_3px_color-mix(in_srgb,var(--selection)_22%,transparent)] group-data-[collapsible=icon]:hidden"
          />
        ) : null}
      </SidebarMenuButton>
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
      commandProps={{
        // External filtering: we control the query and the rows, so disable
        // Base UI's built-in combobox filtering.
        filter: null,
        inputValue: searchQuery,
        onInputValueChange: setSearchQuery,
      }}
      open={open}
      onOpenChange={setOpen}
      title="Chat session picker"
    >
      <CommandInput placeholder="Search chat sessions..." />
      <CommandList className="max-h-[min(420px,70dvh)] py-2">
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
    <header className="z-30 flex h-11 shrink-0 items-center justify-between border-b border-hairline bg-[color-mix(in_oklab,var(--bg)_88%,transparent)] px-4 backdrop-blur-md md:px-6">
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
  head: () => titleHead(),
  component: RootLayout,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  head: () => titleHead("Chat"),
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
  head: () => titleHead("Chat"),
  component: ChatPage,
});

const chatSessionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/chat/$sessionId",
  head: () => titleHead("Chat"),
  component: ChatPage,
});

const wikiRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/wiki",
  head: () => titleHead("Wiki"),
  component: WikiPage,
});

const activityRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/activity",
  head: () => titleHead("Activity"),
  component: ActivityPage,
});

const actionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/actions",
  head: () => titleHead("Action Items"),
  component: ActionsPage,
});

const reviewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/review",
  head: () => titleHead("Review"),
  component: ReviewPage,
});

const routinesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/routines",
  head: () => titleHead("Routines"),
  component: RoutinesPage,
});

const retrievalIndexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/index",
  head: () => titleHead("Retrieval Index"),
  component: RetrievalIndexPage,
});

const connectorsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/connectors",
  head: () => titleHead("Connectors"),
  component: ConnectorsPage,
});

const connectorsNotionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/connectors/notion",
  head: () => titleHead("Notion", "Connectors"),
  component: ConnectorsNotionPage,
});

const connectorsGranolaRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/connectors/granola",
  head: () => titleHead("Granola", "Connectors"),
  component: ConnectorsGranolaPage,
});

const connectorsSlackRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/connectors/slack",
  head: () => titleHead("Slack", "Connectors"),
  component: ConnectorsSlackPage,
});

const mcpsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/mcps",
  head: () => titleHead("MCP"),
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

export const router = createRouter({ routeTree, defaultNotFoundComponent: NotFound });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
