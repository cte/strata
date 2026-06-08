import type { Meta, StoryObj } from "@storybook/react-vite";
import { Calendar, FileText, Settings, User } from "lucide-react";
import type { ReactNode } from "react";
import {
  Command,
  CommandCollection,
  CommandEmpty,
  CommandGroup,
  CommandGroupLabel,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "./command";

const meta = {
  title: "UI/Command",
  component: Command,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
  },
} satisfies Meta<typeof Command>;

export default meta;
type Story = StoryObj<typeof meta>;

interface Action {
  id: string;
  label: string;
  icon: ReactNode;
  shortcut?: string;
  disabled?: boolean;
}

interface ActionGroup {
  label: string;
  items: Action[];
}

/**
 * A Base UI combobox palette: a search input filters the grouped items as you
 * type, with `CommandEmpty` shown when nothing matches.
 */
export const Default: Story = {
  render: () => {
    const groups: ActionGroup[] = [
      {
        label: "Suggestions",
        items: [
          { id: "meetings", label: "Open today's meetings", icon: <Calendar /> },
          { id: "search", label: "Search the wiki", icon: <FileText />, shortcut: "⌘K" },
        ],
      },
      {
        label: "Settings",
        items: [
          { id: "profile", label: "Profile", icon: <User /> },
          { id: "connectors", label: "Connectors", icon: <Settings />, shortcut: "⌘," },
        ],
      },
    ];
    return (
      <Command<Action>
        items={groups}
        itemToStringLabel={(item) => item.label}
        className="w-80 rounded-md border border-hairline bg-surface"
      >
        <CommandInput placeholder="Type a command or search..." />
        <CommandList<ActionGroup>>
          {(group) => (
            <CommandGroup key={group.label} items={group.items}>
              <CommandGroupLabel>{group.label}</CommandGroupLabel>
              <CommandCollection<Action>>
                {(item) => (
                  <CommandItem key={item.id} value={item} disabled={item.disabled}>
                    {item.icon}
                    <span>{item.label}</span>
                    {item.shortcut ? <CommandShortcut>{item.shortcut}</CommandShortcut> : null}
                  </CommandItem>
                )}
              </CommandCollection>
            </CommandGroup>
          )}
        </CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
      </Command>
    );
  },
};

/** Disabled items render dimmed and are not selectable. */
export const WithDisabledItem: Story = {
  render: () => {
    const groups: ActionGroup[] = [
      {
        label: "Routines",
        items: [
          { id: "granola", label: "Granola daily TODO", icon: <FileText /> },
          {
            id: "actions",
            label: "Action extraction (disabled)",
            icon: <FileText />,
            disabled: true,
          },
        ],
      },
    ];
    return (
      <Command<Action>
        items={groups}
        itemToStringLabel={(item) => item.label}
        className="w-80 rounded-md border border-hairline bg-surface"
      >
        <CommandInput placeholder="Search routines..." />
        <CommandList<ActionGroup>>
          {(group) => (
            <CommandGroup key={group.label} items={group.items}>
              <CommandGroupLabel>{group.label}</CommandGroupLabel>
              <CommandCollection<Action>>
                {(item) => (
                  <CommandItem key={item.id} value={item} disabled={item.disabled}>
                    {item.icon}
                    <span>{item.label}</span>
                  </CommandItem>
                )}
              </CommandCollection>
            </CommandGroup>
          )}
        </CommandList>
        <CommandEmpty>No routines found.</CommandEmpty>
      </Command>
    );
  },
};
