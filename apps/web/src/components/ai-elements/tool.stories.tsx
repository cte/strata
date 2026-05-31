import type { Meta, StoryObj } from "@storybook/react-vite";
import { Wrench } from "lucide-react";
import { Tool, ToolContent, ToolHeader } from "./tool";

const meta = {
  title: "AI Elements/Tool",
  component: Tool,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
  },
} satisfies Meta<typeof Tool>;

export default meta;
type Story = StoryObj<typeof meta>;

const INPUT = JSON.stringify({ query: "taxonomy review queue", limit: 5 }, null, 2);
const OUTPUT = JSON.stringify(
  { matches: 2, pages: ["wiki/decisions/2026-04-12-taxonomy-suggestion-routine.md"] },
  null,
  2,
);

/** A completed tool call with input and output JSON. */
export const Complete: Story = {
  render: () => (
    <div className="w-[440px]">
      <Tool status="complete" open>
        <ToolHeader>
          <span className="flex items-center gap-2 font-mono">
            <Wrench size={13} strokeWidth={1.75} />
            wiki.search
          </span>
        </ToolHeader>
        <ToolContent>
          <div className="text-fg-mute">Input</div>
          <pre className="mt-1 whitespace-pre-wrap">{INPUT}</pre>
          <div className="mt-3 text-fg-mute">Output</div>
          <pre className="mt-1 whitespace-pre-wrap">{OUTPUT}</pre>
        </ToolContent>
      </Tool>
    </div>
  ),
};

/** A tool call still running. */
export const Running: Story = {
  render: () => (
    <div className="w-[440px]">
      <Tool status="running">
        <ToolHeader>
          <span className="flex items-center gap-2 font-mono">
            <Wrench size={13} strokeWidth={1.75} />
            wiki.search
          </span>
        </ToolHeader>
        <ToolContent>
          <div className="text-fg-mute">Input</div>
          <pre className="mt-1 whitespace-pre-wrap">{INPUT}</pre>
        </ToolContent>
      </Tool>
    </div>
  ),
};

/** A tool call that errored. */
export const Errored: Story = {
  render: () => (
    <div className="w-[440px]">
      <Tool status="error" open>
        <ToolHeader>
          <span className="flex items-center gap-2 font-mono">
            <Wrench size={13} strokeWidth={1.75} />
            wiki.search
          </span>
        </ToolHeader>
        <ToolContent>
          <div className="text-bad">Error: index not available</div>
        </ToolContent>
      </Tool>
    </div>
  ),
};
