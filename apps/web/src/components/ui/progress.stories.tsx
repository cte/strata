import type { Meta, StoryObj } from "@storybook/react-vite";
import { Progress } from "./progress";

const meta = {
  title: "UI/Progress",
  component: Progress,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
  },
  argTypes: {
    value: {
      control: { type: "range", min: 0, max: 100, step: 1 },
      description: "Completion percentage (0–100).",
    },
  },
  args: {
    value: 40,
  },
  decorators: [
    (Story) => (
      <div className="w-72">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Progress>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Drag the `value` control to see the bar fill. */
export const Default: Story = {};

/** Nothing done yet. */
export const Empty: Story = {
  args: { value: 0 },
};

/** Partway through. */
export const Partial: Story = {
  args: { value: 40 },
};

/** Complete. */
export const Complete: Story = {
  args: { value: 100 },
};

/** A few values stacked for comparison. */
export const Steps: Story = {
  render: () => (
    <div className="flex w-72 flex-col gap-4">
      {[0, 40, 100].map((value) => (
        <div key={value} className="flex flex-col gap-1">
          <span className="text-xs text-fg-mute">{value}%</span>
          <Progress value={value} />
        </div>
      ))}
    </div>
  ),
};
