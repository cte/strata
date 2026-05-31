import type { Meta, StoryObj } from "@storybook/react-vite";
import { Separator } from "./separator";

const meta = {
  title: "UI/Separator",
  component: Separator,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
  },
  argTypes: {
    orientation: {
      control: "inline-radio",
      options: ["horizontal", "vertical"],
      description: "Direction the divider runs.",
    },
  },
  args: {
    orientation: "horizontal",
  },
} satisfies Meta<typeof Separator>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A horizontal rule between two stacked blocks of content. */
export const Horizontal: Story = {
  render: () => (
    <div className="w-72 text-sm text-fg-dim">
      <p className="text-fg">Sessions</p>
      <Separator className="my-3" />
      <p className="text-fg">Routines</p>
    </div>
  ),
};

/** A vertical rule separating inline items. */
export const Vertical: Story = {
  render: () => (
    <div className="flex h-5 items-center gap-3 text-sm text-fg-dim">
      <span>Chat</span>
      <Separator orientation="vertical" />
      <span>Connectors</span>
      <Separator orientation="vertical" />
      <span>Activity</span>
    </div>
  ),
};
