import type { Meta, StoryObj } from "@storybook/react-vite";
import { ThemeToggle } from "./theme-toggle";

const meta = {
  title: "UI/ThemeToggle",
  component: ThemeToggle,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
  },
} satisfies Meta<typeof ThemeToggle>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Clicking this flips the global app theme via `useTheme()` (light/dark) — it
 * mutates the running app's theme state, not Storybook's own theme. The
 * Storybook theme toolbar (top bar) is a separate, unrelated control.
 */
export const Default: Story = {};

/** Shown on the app's elevated surface, the way it appears in the chrome. */
export const InContext: Story = {
  render: () => (
    <div className="flex items-center gap-3 rounded-md border border-hairline bg-bg-elev px-4 py-3">
      <span className="text-sm text-fg-dim">Appearance</span>
      <ThemeToggle />
    </div>
  ),
};
