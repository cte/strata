import type { Meta, StoryObj } from "@storybook/react-vite";
import { ArrowRight, Download, Lock, Plus, Trash2 } from "lucide-react";
import type * as React from "react";
import { Button } from "./button";

const VARIANTS = ["default", "secondary", "outline", "ghost", "destructive", "link"] as const;
const SIZES = ["sm", "default", "lg"] as const;

const meta = {
  title: "UI/Button",
  component: Button,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
  },
  argTypes: {
    variant: {
      control: "select",
      options: VARIANTS,
      description: "Visual style of the button.",
    },
    size: {
      control: "select",
      options: [...SIZES, "icon"],
      description: "Height / padding preset.",
    },
    disabled: { control: "boolean" },
    children: { control: "text" },
  },
  args: {
    children: "Button",
    variant: "default",
    size: "default",
    disabled: false,
  },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Tweak any prop live from the Controls panel. */
export const Playground: Story = {};

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="flex items-center gap-4">
      <span className="label-eyebrow w-24 shrink-0 text-right">{label}</span>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </div>
  );
}

/** Every variant side by side — the main page for comparing button styles. */
export const AllVariants: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      {VARIANTS.map((variant) => (
        <Row key={variant} label={variant}>
          <Button variant={variant}>Button</Button>
          <Button variant={variant}>
            <Plus />
            With icon
          </Button>
          <Button variant={variant}>
            Continue
            <ArrowRight />
          </Button>
          <Button variant={variant} disabled>
            Disabled
          </Button>
        </Row>
      ))}
    </div>
  ),
};

/** All sizes across the most-used variants. */
export const Sizes: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      {(["default", "secondary", "outline"] as const).map((variant) => (
        <Row key={variant} label={variant}>
          {SIZES.map((size) => (
            <Button key={size} variant={variant} size={size}>
              {size}
            </Button>
          ))}
          <Button variant={variant} size="icon" aria-label="Add">
            <Plus />
          </Button>
        </Row>
      ))}
    </div>
  ),
};

/** Icon-only buttons. */
export const IconButtons: Story = {
  render: () => (
    <div className="flex items-center gap-3">
      <Button size="icon" aria-label="Add">
        <Plus />
      </Button>
      <Button variant="secondary" size="icon" aria-label="Download">
        <Download />
      </Button>
      <Button variant="outline" size="icon" aria-label="Lock">
        <Lock />
      </Button>
      <Button variant="ghost" size="icon" aria-label="Delete">
        <Trash2 />
      </Button>
      <Button variant="destructive" size="icon" aria-label="Delete">
        <Trash2 />
      </Button>
    </div>
  ),
};

/**
 * The buttons as they appear on the lock screen and 404 page — a primary action
 * paired with a secondary one, on the app's elevated surface.
 */
export const InContext: Story = {
  render: () => (
    <div className="w-80 rounded-md border border-hairline bg-bg-elev p-6">
      <p className="label-eyebrow">Stratum not found</p>
      <h3 className="mt-2 text-md font-medium tracking-tight text-fg">This layer doesn’t exist</h3>
      <p className="mt-2 text-sm leading-6 text-fg-dim">
        The route you followed isn’t part of the console.
      </p>
      <div className="mt-5 flex items-center gap-3">
        <Button variant="secondary">
          <ArrowRight />
          Back to chat
        </Button>
        <Button variant="outline">Go back</Button>
      </div>
    </div>
  ),
};
