import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "./select";

const meta = {
  title: "UI/Select",
  component: Select,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
  },
} satisfies Meta<typeof Select>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A Base UI select with a placeholder and a short list of options. */
export const Default: Story = {
  render: () => (
    <Select>
      <SelectTrigger className="w-64">
        <SelectValue placeholder="Select a connector" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="granola">Granola</SelectItem>
        <SelectItem value="notion">Notion</SelectItem>
        <SelectItem value="slack">Slack</SelectItem>
      </SelectContent>
    </Select>
  ),
};

/** Grouped options with a label, separator, and a disabled item. */
export const Grouped: Story = {
  render: () => (
    <Select defaultValue="read">
      <SelectTrigger className="w-64">
        <SelectValue placeholder="Select a tool mode" />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectLabel>Safe</SelectLabel>
          <SelectItem value="read">Read</SelectItem>
          <SelectItem value="learning">Learning</SelectItem>
        </SelectGroup>
        <SelectSeparator />
        <SelectGroup>
          <SelectLabel>Guarded</SelectLabel>
          <SelectItem value="write">Write</SelectItem>
          <SelectItem value="dangerous" disabled>
            Dangerous
          </SelectItem>
        </SelectGroup>
      </SelectContent>
    </Select>
  ),
};
