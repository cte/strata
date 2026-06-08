import type { Meta, StoryObj } from "@storybook/react-vite";
import { Plus } from "lucide-react";
import { Button } from "./button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./tooltip";

const meta = {
  title: "UI/Tooltip",
  component: Tooltip,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
  },
} satisfies Meta<typeof Tooltip>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Hover or focus the trigger to show the tooltip. The Base UI tooltip requires a
 * `TooltipProvider` ancestor (it owns the shared hover/delay timing).
 */
export const Default: Story = {
  render: () => (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button variant="outline" size="icon" aria-label="Add routine">
              <Plus />
            </Button>
          }
        />
        <TooltipContent>Add routine</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  ),
};

/** Starts open so the tooltip surface is visible in autodocs. */
export const Open: Story = {
  render: () => (
    <TooltipProvider>
      <Tooltip defaultOpen>
        <TooltipTrigger render={<Button variant="outline">Hover me</Button>} />
        <TooltipContent>This tooltip starts open for the docs page.</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  ),
};
