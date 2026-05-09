import {
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  Outlet,
  useMatchRoute,
} from "@tanstack/react-router";
import { Activity, Clock, GitPullRequest, Settings2 } from "lucide-react";
import type * as React from "react";
import { LiveClock } from "@/components/ui/clock";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { ThemeToggle } from "@/components/ui/theme-toggle";
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
              <NavItem to="/connectors" label="Connectors" icon={GitPullRequest} />
              <DisabledItem label="Schedules" icon={Clock} />
              <DisabledItem label="Settings" icon={Settings2} />
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup className="group-data-[collapsible=icon]:hidden">
          <SidebarGroupLabel className="label-eyebrow !h-7 !px-2 !text-[var(--fg-mute)]">
            Status
          </SidebarGroupLabel>
          <SidebarGroupContent className="px-2">
            <ul className="flex flex-col gap-1.5 py-1 text-[13px]">
              <StatusRow label="Agent" value="idle" tone="dim" />
              <StatusRow label="Trace" value="—" tone="dim" />
              <StatusRow label="Wiki" value="ok" tone="ok" />
            </ul>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-[var(--hairline)] px-3 py-3">
        <div className="flex items-center justify-between text-[11px] group-data-[collapsible=icon]:hidden">
          <span className="label-eyebrow">api</span>
          <span className="font-mono text-[var(--fg-dim)]">127.0.0.1:4174</span>
        </div>
        <span className="label-eyebrow hidden text-center text-[var(--fg-mute)] group-data-[collapsible=icon]:block">
          ·
        </span>
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
  to: "/" | "/connectors";
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

function DisabledItem({
  label,
  icon: Icon,
}: {
  label: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
}): React.ReactElement {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        disabled
        tooltip={`${label} — coming soon`}
        className="rounded-md text-[13px] font-medium tracking-tight text-[var(--fg-mute)]/70 hover:bg-transparent hover:text-[var(--fg-mute)]/70"
      >
        <Icon size={14} strokeWidth={1.75} />
        <span>{label}</span>
        <span className="label-eyebrow ml-auto text-[var(--fg-mute)]/60 group-data-[collapsible=icon]:hidden">
          soon
        </span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

function StatusRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "ok" | "dim";
}): React.ReactElement {
  return (
    <li className="flex items-center justify-between">
      <span className="text-[var(--fg-mute)]">{label}</span>
      <span
        className={`font-mono text-[12px] ${
          tone === "ok" ? "text-[var(--good)]" : "text-[var(--fg-dim)]"
        }`}
      >
        {value}
      </span>
    </li>
  );
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
