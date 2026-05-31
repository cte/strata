import type { Meta, StoryObj } from "@storybook/react-vite";
import { Spinner } from "./spinner";

const meta = {
  title: "UI/Spinner",
  component: Spinner,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
  },
} satisfies Meta<typeof Spinner>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The default loading spinner. */
export const Default: Story = {
  render: () => <Spinner className="text-fg" />,
};

/** Sizes are controlled via `size-*` utilities on the SVG. */
export const Sizes: Story = {
  render: () => (
    <div className="flex items-center gap-6 text-fg">
      <Spinner className="size-3" />
      <Spinner className="size-4" />
      <Spinner className="size-6" />
      <Spinner className="size-8" />
    </div>
  ),
};

/** Tinted with the accent token. */
export const Accent: Story = {
  render: () => <Spinner className="size-6 text-accent" />,
};

/** Inline alongside loading text. */
export const WithLabel: Story = {
  render: () => (
    <div className="flex items-center gap-2 text-sm text-fg-dim">
      <Spinner className="size-4" />
      <span>Loading sessions…</span>
    </div>
  ),
};
