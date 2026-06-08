import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "./button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "./sheet";

const SIDES = ["top", "right", "bottom", "left"] as const;

const meta = {
  title: "UI/Sheet",
  component: Sheet,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
  },
} satisfies Meta<typeof Sheet>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A slide-out panel anchored to the right edge. */
export const Default: Story = {
  render: () => (
    <Sheet>
      <SheetTrigger render={<Button variant="outline">Open sheet</Button>} />
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Edit routine</SheetTitle>
          <SheetDescription>
            Update the trigger cadence and tool profile for this routine.
          </SheetDescription>
        </SheetHeader>
        <div className="py-4 text-sm text-fg-dim">Settings panel content goes here.</div>
        <SheetFooter>
          <SheetClose render={<Button variant="ghost">Cancel</Button>} />
          <SheetClose render={<Button>Save</Button>} />
        </SheetFooter>
      </SheetContent>
    </Sheet>
  ),
};

/** Starts open so the panel surface is visible in autodocs. */
export const Open: Story = {
  render: () => (
    <Sheet defaultOpen>
      <SheetTrigger render={<Button variant="outline">Open sheet</Button>} />
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Ingest history</SheetTitle>
          <SheetDescription>Recent connector pulls and indexing runs.</SheetDescription>
        </SheetHeader>
        <div className="py-4 text-sm text-fg-dim">Activity list goes here.</div>
      </SheetContent>
    </Sheet>
  ),
};

/** All four anchor sides — each opens the panel from a different edge. */
export const Sides: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      {SIDES.map((side) => (
        <Sheet key={side}>
          <SheetTrigger render={<Button variant="outline">{side}</Button>} />
          <SheetContent side={side}>
            <SheetHeader>
              <SheetTitle>Side: {side}</SheetTitle>
              <SheetDescription>This sheet slides in from the {side} edge.</SheetDescription>
            </SheetHeader>
          </SheetContent>
        </Sheet>
      ))}
    </div>
  ),
};
