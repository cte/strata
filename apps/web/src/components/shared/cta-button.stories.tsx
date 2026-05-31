import type { Meta, StoryObj } from "@storybook/react-vite";
import { ArrowRight, ArrowUpRight, Sparkles } from "lucide-react";
import { CtaButton } from "./cta-button";

const meta = {
  title: "UI/CTA Button",
  component: CtaButton,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
  },
  args: {
    children: "Let's Collaborate",
  },
  argTypes: {
    children: { control: "text" },
    disabled: { control: "boolean" },
  },
} satisfies Meta<typeof CtaButton>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Hover the button to see the icon slide across and the label shift. */
export const Default: Story = {};

export const Disabled: Story = {
  args: { disabled: true },
};

/** Different labels and icons. */
export const Variations: Story = {
  render: () => (
    <div className="flex flex-col items-start gap-4">
      <CtaButton icon={ArrowRight}>Unlock console</CtaButton>
      <CtaButton icon={ArrowUpRight}>Open dashboard</CtaButton>
      <CtaButton icon={Sparkles}>Get started</CtaButton>
    </div>
  ),
};

/** Full-width, the way it appears on the lock screen. */
export const FullWidth: Story = {
  render: () => (
    <div className="w-80 rounded-md border border-hairline bg-bg-elev p-6">
      <CtaButton icon={ArrowRight} className="w-full">
        Unlock console
      </CtaButton>
    </div>
  ),
};
