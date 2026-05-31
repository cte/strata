import type { Meta, StoryObj } from "@storybook/react-vite";
import { Badge } from "./badge";

const TONES = ["ready", "warning", "muted", "bad"] as const;

const meta = {
  title: "UI/Badge",
  component: Badge,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
  },
  argTypes: {
    tone: {
      control: "select",
      options: TONES,
      description: "Color tone of the status badge.",
    },
    pulse: {
      control: "boolean",
      description: "Animate the leading dot — only takes effect when tone is `ready`.",
    },
    children: { control: "text" },
  },
  args: {
    children: "Idle",
    tone: "muted",
    pulse: false,
  },
} satisfies Meta<typeof Badge>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Tweak tone and pulse live from the Controls panel. */
export const Default: Story = {};

/** Every tone side by side. */
export const AllTones: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Badge tone="warning">In Progress</Badge>
      <Badge tone="bad">Blocked</Badge>
      <Badge tone="ready">Done</Badge>
      <Badge tone="muted">Idle</Badge>
    </div>
  ),
};

/** The pulsing dot is reserved for the live `ready` tone. */
export const Pulse: Story = {
  args: {
    tone: "ready",
    pulse: true,
    children: "Live",
  },
};
