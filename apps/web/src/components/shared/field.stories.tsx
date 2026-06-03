import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Field, TextField } from "./field";

const meta = {
  title: "Shared/Field",
  component: TextField,
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
  },
  args: {
    label: "Display name",
    onChange: () => {},
  },
} satisfies Meta<typeof TextField>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A labeled controlled text input. */
export const Default: Story = {
  render: () => {
    const [value, setValue] = useState("");
    return (
      <div className="w-80">
        <TextField label="Display name" value={value} onChange={setValue} placeholder="Linear" />
      </div>
    );
  },
};

/** Mono treatment with a hint — for URLs, slugs, or keys. */
export const MonoWithHint: Story = {
  render: () => {
    const [value, setValue] = useState("https://example.com/mcp");
    return (
      <div className="w-96">
        <TextField
          label="Server URL"
          hint="streamable http"
          value={value}
          onChange={setValue}
          mono
        />
      </div>
    );
  },
};

/** `Field` wraps any control, not just an Input. */
export const CustomControl: Story = {
  render: () => (
    <div className="w-80">
      <Field label="Source scope" hint="optional">
        <select className="h-9 rounded-md border border-hairline bg-bg px-3 text-xs text-fg">
          <option>All sources</option>
          <option>Granola</option>
        </select>
      </Field>
    </div>
  ),
};
