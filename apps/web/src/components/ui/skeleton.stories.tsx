import type { Meta, StoryObj } from "@storybook/react-vite";
import { Skeleton } from "./skeleton";

const meta = {
  title: "UI/Skeleton",
  component: Skeleton,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
  },
} satisfies Meta<typeof Skeleton>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A single placeholder block, sized with height/width utilities. */
export const Default: Story = {
  render: () => <Skeleton className="h-4 w-48" />,
};

/** A few stacked lines, as you'd use for a loading text block. */
export const TextLines: Story = {
  render: () => (
    <div className="flex w-64 flex-col gap-2">
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-5/6" />
      <Skeleton className="h-3 w-2/3" />
    </div>
  ),
};

/** A composed card placeholder: avatar, heading, and body lines. */
export const Card: Story = {
  render: () => (
    <div className="flex w-72 items-start gap-3 rounded-md border border-hairline bg-bg-elev p-4">
      <Skeleton className="size-10 rounded-full" />
      <div className="flex flex-1 flex-col gap-2">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-4/5" />
      </div>
    </div>
  ),
};
