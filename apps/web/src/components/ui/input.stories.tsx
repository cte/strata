import type { Meta, StoryObj } from "@storybook/react-vite";
import { Input } from "./input";

const meta = {
  title: "UI/Input",
  component: Input,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
  },
  argTypes: {
    type: {
      control: "select",
      options: ["text", "email", "password", "number", "search"],
      description: "Native input type.",
    },
    placeholder: { control: "text" },
    disabled: { control: "boolean" },
  },
  args: {
    type: "text",
    placeholder: "Search the console…",
    disabled: false,
  },
  decorators: [
    (Story) => (
      <div className="w-72">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Input>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Tweak any prop live from the Controls panel. */
export const Default: Story = {};

/** Empty input showing its placeholder hint. */
export const Placeholder: Story = {
  args: {
    placeholder: "name@example.com",
    type: "email",
  },
};

/** Pre-filled with a value. */
export const WithValue: Story = {
  args: {
    defaultValue: "strata-console",
  },
};

/** Non-interactive disabled state. */
export const Disabled: Story = {
  args: {
    defaultValue: "Locked field",
    disabled: true,
  },
};
