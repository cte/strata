import type { Meta, StoryObj } from "@storybook/react-vite";
import { ChevronsUpDown } from "lucide-react";
import { Button } from "./button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./collapsible";

const meta = {
  title: "UI/Collapsible",
  component: Collapsible,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
  },
} satisfies Meta<typeof Collapsible>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A trigger button toggles the collapsible content. Starts closed. */
export const Default: Story = {
  render: () => (
    <Collapsible className="w-80 rounded-md border border-hairline bg-surface p-4">
      <div className="flex items-center justify-between gap-4">
        <span className="text-sm font-medium text-fg">Trigger configuration</span>
        <CollapsibleTrigger render={<Button variant="ghost" size="icon" aria-label="Toggle" />}>
          <ChevronsUpDown />
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent className="mt-3 space-y-2 text-sm text-fg-dim">
        <p>Cron: 0 9 * * 1-5</p>
        <p>Tool profile: maintenance</p>
        <p>Pre-run jobs: connector.pull, raw.index</p>
      </CollapsibleContent>
    </Collapsible>
  ),
};

/** Rendered open via `defaultOpen`. */
export const Open: Story = {
  render: () => (
    <Collapsible defaultOpen className="w-80 rounded-md border border-hairline bg-surface p-4">
      <div className="flex items-center justify-between gap-4">
        <span className="text-sm font-medium text-fg">Required skills</span>
        <CollapsibleTrigger render={<Button variant="ghost" size="icon" aria-label="Toggle" />}>
          <ChevronsUpDown />
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent className="mt-3 space-y-2 text-sm text-fg-dim">
        <p>wiki-curation</p>
        <p>taxonomy-review</p>
      </CollapsibleContent>
    </Collapsible>
  ),
};
