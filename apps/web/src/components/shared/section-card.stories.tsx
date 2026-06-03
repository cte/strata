import type { Meta, StoryObj } from "@storybook/react-vite";
import { Database, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SectionCard } from "./section-card";

const meta = {
  title: "Shared/Section Card",
  component: SectionCard,
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
  },
  args: {
    title: "Manual reindex",
    description: "Rebuilds derived SQLite retrieval tables from the current wiki.",
  },
} satisfies Meta<typeof SectionCard>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Header (icon + title + description) with a body. */
export const Default: Story = {
  render: (args) => (
    <SectionCard {...args} icon={<Database size={14} strokeWidth={1.75} />}>
      <p className="text-sm text-fg-dim">Body content goes here.</p>
    </SectionCard>
  ),
};

/** Right-aligned `actions` slot for badges or buttons. */
export const WithActions: Story = {
  render: (args) => (
    <SectionCard
      {...args}
      icon={<Database size={14} strokeWidth={1.75} />}
      actions={
        <>
          <Badge tone="ready" pulse>
            indexed
          </Badge>
          <Button size="sm" variant="ghost">
            <RefreshCw size={13} strokeWidth={2} />
            Refresh
          </Button>
        </>
      }
    >
      <p className="text-sm text-fg-dim">Body content goes here.</p>
    </SectionCard>
  ),
};

/** No header props — a plain padded card. */
export const Bare: Story = {
  args: { title: undefined, description: undefined },
  render: (args) => (
    <SectionCard {...args}>
      <p className="text-sm text-fg-dim">A plain bordered card with no header.</p>
    </SectionCard>
  ),
};
