import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { CheckToggle } from "./check-toggle";

const meta = {
  title: "Shared/Check Toggle",
  component: CheckToggle,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
  },
  args: {
    label: "Include private channels",
    checked: false,
    onChange: () => {},
  },
} satisfies Meta<typeof CheckToggle>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => {
    const [checked, setChecked] = useState(args.checked);
    return <CheckToggle {...args} checked={checked} onChange={setChecked} />;
  },
};

export const Disabled: Story = {
  args: { disabled: true, checked: true },
};

/** A column of options, the way connector pages use it. */
export const Group: Story = {
  render: () => {
    const [state, setState] = useState({ a: true, b: false, c: false });
    return (
      <div className="grid gap-2">
        <CheckToggle
          checked={state.a}
          label="Allow all-history backfill"
          onChange={(a) => setState((s) => ({ ...s, a }))}
        />
        <CheckToggle
          checked={state.b}
          label="Include private channels"
          onChange={(b) => setState((s) => ({ ...s, b }))}
        />
        <CheckToggle
          checked={state.c}
          label="Include bot messages"
          onChange={(c) => setState((s) => ({ ...s, c }))}
        />
      </div>
    );
  },
};
