import type { Meta, StoryObj } from "@storybook/react-vite";
import type { LanguageModelUsage } from "ai";
import {
  Context,
  ContextCacheUsage,
  ContextContent,
  ContextContentBody,
  ContextContentFooter,
  ContextContentHeader,
  ContextInputUsage,
  ContextOutputUsage,
  ContextReasoningUsage,
  ContextTrigger,
} from "./context";

const USAGE: LanguageModelUsage = {
  inputTokens: 48_210,
  inputTokenDetails: {
    noCacheTokens: 17_210,
    cacheReadTokens: 31_000,
    cacheWriteTokens: 0,
  },
  outputTokens: 6_540,
  outputTokenDetails: {
    textTokens: 4_360,
    reasoningTokens: 2_180,
  },
  reasoningTokens: 2_180,
  cachedInputTokens: 31_000,
  totalTokens: 54_750,
};

const SHARED_ARGS = {
  maxTokens: 200_000,
  usedTokens: USAGE.totalTokens ?? 0,
  usage: USAGE,
} as const;

const meta = {
  title: "AI Elements/Context",
  component: Context,
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
  },
} satisfies Meta<typeof Context>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Token-usage gauge with the hover card forced open so the input / output /
 * reasoning / cache breakdown and total cost are visible.
 */
export const Default: Story = {
  args: SHARED_ARGS,
  render: () => (
    <div className="flex min-h-72 items-start justify-center">
      <Context
        maxTokens={200_000}
        modelId="anthropic:claude-opus-4-8"
        open
        usage={USAGE}
        usedTokens={USAGE.totalTokens ?? 0}
      >
        <ContextTrigger />
        <ContextContent>
          <ContextContentHeader />
          <ContextContentBody>
            <div className="space-y-1">
              <ContextInputUsage />
              <ContextOutputUsage />
              <ContextReasoningUsage />
              <ContextCacheUsage />
            </div>
          </ContextContentBody>
          <ContextContentFooter />
        </ContextContent>
      </Context>
    </div>
  ),
};

/** Just the compact trigger button as it sits inline next to a chat composer. */
export const TriggerOnly: Story = {
  args: SHARED_ARGS,
  render: () => (
    <Context maxTokens={200_000} usage={USAGE} usedTokens={USAGE.totalTokens ?? 0}>
      <ContextTrigger />
    </Context>
  ),
};
