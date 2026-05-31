import type { Meta, StoryObj } from "@storybook/react-vite";
import { Switch } from "./switch";

const meta = {
  title: "UI/Switch",
  component: Switch,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
  },
  argTypes: {
    checked: { control: "boolean" },
    disabled: { control: "boolean" },
  },
  args: {
    disabled: false,
  },
} satisfies Meta<typeof Switch>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Uncontrolled switch — toggle it directly. */
export const Default: Story = {};

/** On by default. */
export const Checked: Story = {
  args: {
    defaultChecked: true,
  },
};

/** Disabled in the off position. */
export const Disabled: Story = {
  args: {
    disabled: true,
  },
};

/** Disabled while on. */
export const DisabledChecked: Story = {
  args: {
    disabled: true,
    defaultChecked: true,
  },
};

/** Paired with a label, as used in settings rows. */
export const WithLabel: Story = {
  render: () => (
    <label className="flex items-center gap-3 text-sm text-fg">
      <Switch defaultChecked />
      <span>Enable routine trigger</span>
    </label>
  ),
};
