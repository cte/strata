import type { Meta, StoryObj } from "@storybook/react-vite";
import { Settings2 } from "lucide-react";
import { Button } from "./button";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";

const meta = {
  title: "UI/Popover",
  component: Popover,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
  },
} satisfies Meta<typeof Popover>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Click the trigger to reveal a floating panel anchored to it. */
export const Default: Story = {
  render: () => (
    <Popover>
      <PopoverTrigger
        render={
          <Button variant="outline">
            <Settings2 />
            Display
          </Button>
        }
      />
      <PopoverContent>
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium text-fg">Display options</p>
          <p className="text-xs text-fg-mute">
            Tune how the activity list renders. Changes apply immediately.
          </p>
        </div>
      </PopoverContent>
    </Popover>
  ),
};

/** Starts open so the floating surface is visible in autodocs. */
export const Open: Story = {
  render: () => (
    <Popover defaultOpen>
      <PopoverTrigger
        render={
          <Button variant="outline">
            <Settings2 />
            Display
          </Button>
        }
      />
      <PopoverContent>
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium text-fg">Display options</p>
          <p className="text-xs text-fg-mute">
            This popover starts open for the documentation page.
          </p>
        </div>
      </PopoverContent>
    </Popover>
  ),
};
