import type { Meta, StoryObj } from "@storybook/react-vite";
import { FolderOpen, Inbox, Plus } from "lucide-react";
import { Button } from "./button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "./empty";

const meta = {
  title: "UI/Empty",
  component: Empty,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
  },
} satisfies Meta<typeof Empty>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A full empty-state: media icon, title, description, and a primary action. */
export const Default: Story = {
  render: () => (
    <Empty className="w-96 border border-hairline">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Inbox />
        </EmptyMedia>
        <EmptyTitle>No routines yet</EmptyTitle>
        <EmptyDescription>
          Create a routine to run scheduled agent work over your wiki.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button>
          <Plus />
          New routine
        </Button>
      </EmptyContent>
    </Empty>
  ),
};

/** Header only, no action — the lightest variant. */
export const HeaderOnly: Story = {
  render: () => (
    <Empty className="w-96 border border-hairline">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <FolderOpen />
        </EmptyMedia>
        <EmptyTitle>Nothing ingested</EmptyTitle>
        <EmptyDescription>Connect a source to start populating the wiki.</EmptyDescription>
      </EmptyHeader>
    </Empty>
  ),
};
