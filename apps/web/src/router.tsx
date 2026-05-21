import {
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  Outlet,
  useMatchRoute,
  useSearch,
} from "@tanstack/react-router";
import { Activity, GitPullRequest, LoaderCircle, MessageSquare, Plus, Search } from "lucide-react";
import type * as React from "react";
import { useCallback } from "react";
import { LiveClock } from "@/components/ui/clock";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
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
import type { ChatSessionSummary } from "@/lib/api";
import { useChatSessions } from "@/lib/useChatSessions";
import { cn } from "@/lib/utils";
import { ChatPage } from "@/routes/chat";
import { ConnectorsPage } from "@/routes/connectors";
import { ConnectorsGranolaPage } from "@/routes/connectors-granola";
import { ConnectorsNotionPage } from "@/routes/connectors-notion";
import { ConnectorsSlackPage } from "@/routes/connectors-slack";
import { DashboardPage } from "@/routes/dashboard";

function RootLayout(): React.ReactElement {
  return (
    <SidebarProvider defaultOpen={true}>
      <AppSidebar />
      <SidebarInset>
        <TopRail />
        <main className="min-w-0 px-6 py-8 md:px-10 md:py-10">
          <Outlet />
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}

function AppSidebar(): React.ReactElement {
  return (
    <Sidebar collapsible="icon" className="border-r border-[var(--hairline)]">
      <SidebarHeader className="px-3 py-3">
        <div className="flex items-center justify-between">
          <span className="text-[13px] font-medium tracking-tight text-[var(--fg)] group-data-[collapsible=icon]:hidden">
            Strata
          </span>
          <span className="font-mono text-[11px] text-[var(--fg-mute)] group-data-[collapsible=icon]:hidden">
            v0.1.0
          </span>
        </div>
      </SidebarHeader>

      <SidebarContent className="gap-0">
        <SidebarGroup>
          <SidebarGroupLabel className="label-eyebrow !h-7 !px-2 !text-[var(--fg-mute)]">
            Navigation
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <NavItem to="/" label="Overview" icon={Activity} />
              <ChatNavItem />
              <NavItem to="/connectors" label="Connectors" icon={GitPullRequest} />
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
  to: "/" | "/chat" | "/connectors";
  label: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
}): React.ReactElement {
  const matchRoute = useMatchRoute();
  // /connectors should stay highlighted on /connectors/<connector-name> too.
  const isActive = !!matchRoute({ to, fuzzy: to !== "/" });

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
  const isActive = !!matchRoute({ to: "/chat", fuzzy: true });
  const { isMobile, setOpenMobile } = useSidebar();
  const rawSearch = useSearch({ strict: false }) as { session?: string } | undefined;
  const activeSessionId = isActive ? (rawSearch?.session ?? null) : null;
  const { searchQuery, setSearchQuery, sessions, isLoaded } = useChatSessions();

  const closeMobileSidebar = useCallback(() => {
    if (isMobile) {
      setOpenMobile(false);
    }
  }, [isMobile, setOpenMobile]);

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        isActive={isActive}
        tooltip="Chat"
        className="group/nav rounded-md text-[13px] font-medium tracking-tight text-[var(--fg-dim)] data-[active=true]:bg-[var(--surface-2)] data-[active=true]:text-[var(--fg)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)]"
      >
        <Link to="/chat" onClick={closeMobileSidebar}>
          <MessageSquare size={14} strokeWidth={1.75} />
          <span>Chat</span>
          {isActive ? (
            <span
              aria-hidden="true"
              className="ml-auto h-1.5 w-1.5 rounded-full bg-[var(--accent)] group-data-[collapsible=icon]:hidden"
            />
          ) : null}
        </Link>
      </SidebarMenuButton>

      {isActive ? (
        <ChatSessionSubMenu
          activeSessionId={activeSessionId}
          onNavigate={closeMobileSidebar}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          sessions={sessions}
          sessionsLoaded={isLoaded}
        />
      ) : null}
    </SidebarMenuItem>
  );
}

function ChatSessionSubMenu({
  activeSessionId,
  onNavigate,
  searchQuery,
  setSearchQuery,
  sessions,
  sessionsLoaded,
}: {
  activeSessionId: string | null;
  onNavigate(): void;
  searchQuery: string;
  setSearchQuery(value: string): void;
  sessions: ChatSessionSummary[];
  sessionsLoaded: boolean;
}): React.ReactElement {
  return (
    <div className="mt-1 flex flex-col gap-1.5 group-data-[collapsible=icon]:hidden">
      <div className="flex items-center gap-2 px-3.5">
        <label className="relative flex-1">
          <Search
            size={13}
            strokeWidth={1.75}
            className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-[var(--fg-mute)]"
          />
          <input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search sessions"
            className="h-8 w-full rounded-md border border-[var(--hairline)] bg-[var(--bg)] pr-2.5 pl-8 text-[12px] text-[var(--fg)] outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-[var(--fg-mute)] focus:border-[var(--accent)] focus:shadow-[0_0_0_3px_var(--accent-soft)]"
          />
        </label>
        <Link
          to="/chat"
          onClick={onNavigate}
          aria-label="New chat"
          title="New chat"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[var(--hairline-strong)] text-[var(--fg-dim)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
        >
          <Plus size={13} strokeWidth={1.75} />
        </Link>
      </div>
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
  onNavigate,
  session,
}: {
  active: boolean;
  onNavigate(): void;
  session: ChatSessionSummary;
}): React.ReactElement {
  const title = sanitizeDisplayText(session.title);
  return (
    <SidebarMenuSubItem>
      <SidebarMenuSubButton
        asChild
        isActive={active}
        size="sm"
        className="h-auto items-start gap-2 py-1.5 data-[active=true]:bg-[var(--accent-soft)] data-[active=true]:text-[var(--fg)]"
      >
        <Link to="/chat" search={{ session: session.id }} onClick={onNavigate}>
          <span
            className={cn("mt-1 h-1.5 w-1.5 shrink-0 rounded-full", statusDotClass(session.status))}
          />
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-[12px] tracking-tight text-[var(--fg)]">{title}</span>
            <span className="font-mono text-[10px] text-[var(--fg-mute)]">
              {formatSessionTime(session.startedAt)}
            </span>
          </span>
        </Link>
      </SidebarMenuSubButton>
    </SidebarMenuSubItem>
  );
}

function SessionRowSkeleton(): React.ReactElement {
  return (
    <li className="flex items-center justify-center px-2 py-3 text-[var(--fg-mute)]">
      <LoaderCircle size={12} strokeWidth={1.75} className="animate-spin" />
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

function TopRail(): React.ReactElement {
  return (
    <header className="sticky top-0 z-30 flex h-11 items-center justify-between border-b border-[var(--hairline)] bg-[color-mix(in_oklab,var(--bg)_88%,transparent)] px-4 backdrop-blur-md md:px-6">
      <SidebarTrigger className="!h-7 !w-7 text-[var(--fg-dim)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)]" />
      <div className="flex items-center gap-4">
        <LiveClock />
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
  component: DashboardPage,
});

export const chatRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/chat",
  component: ChatPage,
  validateSearch: (search): { session?: string } => ({
    ...(typeof search.session === "string" && search.session.length > 0
      ? { session: search.session }
      : {}),
  }),
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
