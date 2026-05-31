import type { Meta, StoryObj } from "@storybook/react-vite";
import { Mail, Search, Send } from "lucide-react";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
} from "./input-group";

const meta = {
  title: "UI/InputGroup",
  component: InputGroup,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
  },
} satisfies Meta<typeof InputGroup>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A leading icon addon (`align="inline-start"`, the default). */
export const LeadingIcon: Story = {
  render: () => (
    <InputGroup className="w-72">
      <InputGroupAddon>
        <Search />
      </InputGroupAddon>
      <InputGroupInput placeholder="Search the wiki..." />
    </InputGroup>
  ),
};

/** A trailing button addon (`align="inline-end"`). */
export const TrailingButton: Story = {
  render: () => (
    <InputGroup className="w-72">
      <InputGroupInput placeholder="Ask the agent..." />
      <InputGroupAddon align="inline-end">
        <InputGroupButton aria-label="Send">
          <Send />
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  ),
};

/** Both a leading icon and a trailing text addon. */
export const LeadingAndTrailing: Story = {
  render: () => (
    <InputGroup className="w-80">
      <InputGroupAddon>
        <Mail />
      </InputGroupAddon>
      <InputGroupInput placeholder="username" />
      <InputGroupAddon align="inline-end">
        <InputGroupText>@gmail.com</InputGroupText>
      </InputGroupAddon>
    </InputGroup>
  ),
};
