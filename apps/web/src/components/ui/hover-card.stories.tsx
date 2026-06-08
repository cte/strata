import type { Meta, StoryObj } from "@storybook/react-vite";
import { CalendarDays } from "lucide-react";
import { Button } from "./button";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "./hover-card";

const meta = {
  title: "UI/HoverCard",
  component: HoverCard,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
  },
} satisfies Meta<typeof HoverCard>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Hover (or focus) the trigger to reveal a preview card. */
export const Default: Story = {
  render: () => (
    <HoverCard>
      <HoverCardTrigger render={<Button variant="link">@strata</Button>} />
      <HoverCardContent>
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium text-fg">Strata</p>
          <p className="text-xs text-fg-dim">
            A local, agent-maintained personal work system over a Markdown wiki.
          </p>
          <div className="flex items-center gap-1 text-xs text-fg-mute">
            <CalendarDays className="size-3.5" />
            <span>Indexed 2 hours ago</span>
          </div>
        </div>
      </HoverCardContent>
    </HoverCard>
  ),
};

/** Starts open so the preview surface is visible in autodocs. */
export const Open: Story = {
  render: () => (
    <HoverCard defaultOpen>
      <HoverCardTrigger render={<Button variant="link">@strata</Button>} />
      <HoverCardContent>
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium text-fg">Strata</p>
          <p className="text-xs text-fg-dim">This hover card starts open for the docs page.</p>
        </div>
      </HoverCardContent>
    </HoverCard>
  ),
};
