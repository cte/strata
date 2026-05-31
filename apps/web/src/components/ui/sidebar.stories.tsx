import type { Meta, StoryObj } from "@storybook/react-vite";
import { FileText, Inbox, LayoutDashboard, Settings, Users, Workflow } from "lucide-react";
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
  SidebarTrigger,
} from "./sidebar";

const meta = {
  title: "UI/Sidebar",
  component: Sidebar,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof Sidebar>;

export default meta;
type Story = StoryObj<typeof meta>;

const MAIN_NAV = [
  { title: "Overview", icon: LayoutDashboard },
  { title: "Activity", icon: Inbox },
  { title: "Routines", icon: Workflow },
] as const;

const WIKI_NAV = [
  { title: "People", icon: Users },
  { title: "Pages", icon: FileText },
] as const;

/**
 * A small but realistic layout: `SidebarProvider` wraps a `Sidebar` (two groups
 * of menu items + a footer) next to a `SidebarInset` main area. The container is
 * given an explicit height so the layout component has room to render in
 * Storybook.
 */
export const Default: Story = {
  render: () => (
    <SidebarProvider style={{ height: "32rem" }}>
      <Sidebar>
        <SidebarHeader>
          <div className="px-2 py-1">
            <p className="label-eyebrow">Strata</p>
            <p className="text-sm text-fg-dim">Control plane</p>
          </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Workspace</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {MAIN_NAV.map((item, index) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton isActive={index === 0}>
                      <item.icon />
                      <span>{item.title}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
          <SidebarGroup>
            <SidebarGroupLabel>Wiki</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {WIKI_NAV.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton>
                      <item.icon />
                      <span>{item.title}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton>
                <Settings />
                <span>Settings</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset>
        <header className="flex items-center gap-2 border-b border-hairline px-4 py-3">
          <SidebarTrigger />
          <span className="text-sm font-medium text-fg">Overview</span>
        </header>
        <div className="flex-1 p-6">
          <p className="label-eyebrow">Placeholder</p>
          <h2 className="mt-2 text-md font-medium tracking-tight text-fg">Main content area</h2>
          <p className="mt-2 max-w-prose text-sm leading-6 text-fg-dim">
            The inset holds the page body. Use the trigger in the header (or Cmd/Ctrl+B) to collapse
            and expand the sidebar.
          </p>
        </div>
      </SidebarInset>
    </SidebarProvider>
  ),
};
