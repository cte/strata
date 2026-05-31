import type { Meta, StoryObj } from "@storybook/react-vite";
import { Calendar, FileText, Settings, User } from "lucide-react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
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

/**
 * An inline `cmdk` palette: a search input filters the grouped items as you
 * type, with `CommandEmpty` shown when nothing matches.
 */
export const Default: Story = {
  render: () => (
    <Command className="w-80 rounded-md border border-hairline bg-surface text-fg">
      <CommandInput placeholder="Type a command or search..." />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        <CommandGroup heading="Suggestions">
          <CommandItem>
            <Calendar />
            <span>Open today's meetings</span>
          </CommandItem>
          <CommandItem>
            <FileText />
            <span>Search the wiki</span>
            <CommandShortcut>⌘K</CommandShortcut>
          </CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Settings">
          <CommandItem>
            <User />
            <span>Profile</span>
          </CommandItem>
          <CommandItem>
            <Settings />
            <span>Connectors</span>
            <CommandShortcut>⌘,</CommandShortcut>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </Command>
  ),
};

/** Disabled items render dimmed and are not selectable. */
export const WithDisabledItem: Story = {
  render: () => (
    <Command className="w-80 rounded-md border border-hairline bg-surface text-fg">
      <CommandInput placeholder="Search routines..." />
      <CommandList>
        <CommandEmpty>No routines found.</CommandEmpty>
        <CommandGroup heading="Routines">
          <CommandItem>
            <FileText />
            <span>Granola daily TODO</span>
          </CommandItem>
          <CommandItem disabled>
            <FileText />
            <span>Action extraction (disabled)</span>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </Command>
  ),
};
