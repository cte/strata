import type { Meta, StoryObj } from "@storybook/react-vite";
import { Textarea } from "./textarea";

const meta = {
  title: "UI/Textarea",
  component: Textarea,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
  },
  argTypes: {
    placeholder: { control: "text" },
    disabled: { control: "boolean" },
    rows: { control: "number" },
  },
  args: {
    placeholder: "Add a note…",
    disabled: false,
  },
  decorators: [
    (Story) => (
      <div className="w-80">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Textarea>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Tweak any prop live from the Controls panel. */
export const Default: Story = {};

/** Empty textarea showing its placeholder hint. */
export const Placeholder: Story = {
  args: {
    placeholder: "Describe what this routine should do…",
    rows: 4,
  },
};

/** Pre-filled with multi-line content. */
export const WithValue: Story = {
  args: {
    rows: 4,
    defaultValue:
      "Pull the latest Granola transcripts.\nIndex them into the wiki.\nStage any new action items for review.",
  },
};

/** Non-interactive disabled state. */
export const Disabled: Story = {
  args: {
    disabled: true,
    defaultValue: "This field is read-only.",
  },
};
