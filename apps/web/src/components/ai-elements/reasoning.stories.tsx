import type { Meta, StoryObj } from "@storybook/react-vite";
import { Reasoning, ReasoningContent, ReasoningTrigger } from "./reasoning";

const meta = {
  title: "AI Elements/Reasoning",
  component: Reasoning,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
  },
} satisfies Meta<typeof Reasoning>;

export default meta;
type Story = StoryObj<typeof meta>;

const THINKING_TEXT = `The user is asking about the taxonomy review queue.

1. Reviewer corrections apply immediately.
2. LLM suggestions stage \`schema\` proposals for review.
3. There is no manual taxonomy-config UI.

I'll summarize these three points clearly.`;

/** Collapsed by default — click the trigger to reveal the thinking text. */
export const Collapsed: Story = {
  render: () => (
    <div className="w-[440px]">
      <Reasoning duration={4}>
        <ReasoningTrigger />
        <ReasoningContent>{THINKING_TEXT}</ReasoningContent>
      </Reasoning>
    </div>
  ),
};

/** Expanded via `defaultOpen`, showing the rendered reasoning. */
export const Expanded: Story = {
  render: () => (
    <div className="w-[440px]">
      <Reasoning defaultOpen duration={4}>
        <ReasoningTrigger />
        <ReasoningContent>{THINKING_TEXT}</ReasoningContent>
      </Reasoning>
    </div>
  ),
};
