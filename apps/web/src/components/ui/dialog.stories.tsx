import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "./button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./dialog";

const meta = {
  title: "UI/Dialog",
  component: Dialog,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
  },
} satisfies Meta<typeof Dialog>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Click the trigger to open a modal dialog with header, body, and footer actions. */
export const Default: Story = {
  render: () => (
    <Dialog>
      <DialogTrigger render={<Button variant="outline">Open dialog</Button>} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete stratum</DialogTitle>
          <DialogDescription>
            This permanently removes the layer and everything it indexes. This action cannot be
            undone.
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm text-fg-dim">
          You can re-ingest the source material later, but local annotations will be lost.
        </p>
        <DialogFooter>
          <DialogClose render={<Button variant="ghost">Cancel</Button>} />
          <DialogClose render={<Button variant="destructive">Delete</Button>} />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
};

/** Starts open so the dialog surface is visible in autodocs. */
export const Open: Story = {
  render: () => (
    <Dialog defaultOpen>
      <DialogTrigger render={<Button variant="outline">Open dialog</Button>} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Connector settings</DialogTitle>
          <DialogDescription>
            Configure how this connector pulls source material into the wiki.
          </DialogDescription>
        </DialogHeader>
        <div className="text-sm text-fg-dim">Changes apply on the next scheduled pull.</div>
        <DialogFooter>
          <DialogClose render={<Button variant="ghost">Cancel</Button>} />
          <DialogClose render={<Button>Save</Button>} />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
};
