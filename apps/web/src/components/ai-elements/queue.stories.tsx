import type { Meta, StoryObj } from "@storybook/react-vite";
import { ListTodoIcon, PencilIcon, Trash2Icon } from "lucide-react";
import {
  Queue,
  QueueItem,
  QueueItemAction,
  QueueItemActions,
  QueueItemContent,
  QueueItemDescription,
  QueueItemIndicator,
  QueueList,
  QueueSection,
  QueueSectionContent,
  QueueSectionLabel,
  QueueSectionTrigger,
} from "./queue";

const meta = {
  title: "AI Elements/Queue",
  component: Queue,
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
  },
} satisfies Meta<typeof Queue>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A queue of pending follow-up messages with hover actions on each item. */
export const Default: Story = {
  render: () => (
    <Queue className="w-[420px]">
      <QueueList>
        <QueueItem>
          <div className="flex items-start gap-2">
            <QueueItemIndicator />
            <QueueItemContent>Summarize today's Granola meetings</QueueItemContent>
            <QueueItemActions>
              <QueueItemAction aria-label="Edit">
                <PencilIcon size={13} />
              </QueueItemAction>
              <QueueItemAction aria-label="Remove">
                <Trash2Icon size={13} />
              </QueueItemAction>
            </QueueItemActions>
          </div>
          <QueueItemDescription>Queued · sends after the current run</QueueItemDescription>
        </QueueItem>

        <QueueItem>
          <div className="flex items-start gap-2">
            <QueueItemIndicator />
            <QueueItemContent>Draft action items for the platform project</QueueItemContent>
            <QueueItemActions>
              <QueueItemAction aria-label="Edit">
                <PencilIcon size={13} />
              </QueueItemAction>
              <QueueItemAction aria-label="Remove">
                <Trash2Icon size={13} />
              </QueueItemAction>
            </QueueItemActions>
          </div>
          <QueueItemDescription>Follow-up · runs once steering clears</QueueItemDescription>
        </QueueItem>

        <QueueItem>
          <div className="flex items-start gap-2">
            <QueueItemIndicator completed />
            <QueueItemContent completed>Refresh the wiki search index</QueueItemContent>
          </div>
          <QueueItemDescription completed>Completed</QueueItemDescription>
        </QueueItem>
      </QueueList>
    </Queue>
  ),
};

/** A collapsible section grouping queued items under a labelled header. */
export const WithSection: Story = {
  render: () => (
    <Queue className="w-[420px]">
      <QueueSection>
        <QueueSectionTrigger>
          <QueueSectionLabel
            count={2}
            icon={<ListTodoIcon className="size-4" />}
            label="queued messages"
          />
        </QueueSectionTrigger>
        <QueueSectionContent>
          <QueueList>
            <QueueItem>
              <div className="flex items-start gap-2">
                <QueueItemIndicator />
                <QueueItemContent>Review taxonomy suggestion proposals</QueueItemContent>
                <QueueItemActions>
                  <QueueItemAction aria-label="Remove">
                    <Trash2Icon size={13} />
                  </QueueItemAction>
                </QueueItemActions>
              </div>
              <QueueItemDescription>Steering · drains after this response</QueueItemDescription>
            </QueueItem>
            <QueueItem>
              <div className="flex items-start gap-2">
                <QueueItemIndicator />
                <QueueItemContent>Stage the daily TODO routine artifact</QueueItemContent>
                <QueueItemActions>
                  <QueueItemAction aria-label="Remove">
                    <Trash2Icon size={13} />
                  </QueueItemAction>
                </QueueItemActions>
              </div>
              <QueueItemDescription>Follow-up</QueueItemDescription>
            </QueueItem>
          </QueueList>
        </QueueSectionContent>
      </QueueSection>
    </Queue>
  ),
};
