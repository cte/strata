import type { Meta, StoryObj } from "@storybook/react-vite";
import type * as React from "react";
import { cn } from "@/lib/utils";
import { ScrollArea } from "./scroll-area";

const meta = {
  title: "UI/ScrollArea",
  component: ScrollArea,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
  },
} satisfies Meta<typeof ScrollArea>;

export default meta;
type Story = StoryObj<typeof meta>;

const ROWS = Array.from({ length: 30 }, (_, index) => ({
  id: index + 1,
  label: `Source ${String(index + 1).padStart(2, "0")}`,
  detail: index % 2 === 0 ? "indexed" : "pending",
}));

/** A fixed-height viewport with more rows than fit, so it scrolls vertically. */
export const Vertical: Story = {
  render: () => (
    <ScrollArea className="h-72 w-72 rounded-md border border-hairline bg-bg-elev">
      <div className="p-4">
        <p className="label-eyebrow mb-3">Ingest queue</p>
        <ul className="flex flex-col">
          {ROWS.map((row) => (
            <li
              key={row.id}
              className={cn(
                "flex items-center justify-between gap-4 border-b border-hairline py-2 last:border-b-0",
                "text-sm text-fg-dim",
              )}
            >
              <span className="text-fg">{row.label}</span>
              <span className="text-xs text-fg-mute">{row.detail}</span>
            </li>
          ))}
        </ul>
      </div>
    </ScrollArea>
  ),
};

/** A short list that fits inside the viewport — no scrollbar appears. */
export const NoOverflow: Story = {
  render: () => (
    <ScrollArea className="h-72 w-72 rounded-md border border-hairline bg-bg-elev">
      <div className="p-4">
        <p className="label-eyebrow mb-3">Recent</p>
        <ul className="flex flex-col">
          {ROWS.slice(0, 5).map((row) => (
            <li
              key={row.id}
              className="flex items-center justify-between gap-4 border-b border-hairline py-2 text-sm text-fg-dim last:border-b-0"
            >
              <span className="text-fg">{row.label}</span>
              <span className="text-xs text-fg-mute">{row.detail}</span>
            </li>
          ))}
        </ul>
      </div>
    </ScrollArea>
  ),
};
