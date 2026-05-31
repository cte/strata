import type { Meta, StoryObj } from "@storybook/react-vite";
import { CheckIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  ModelSelector,
  ModelSelectorContent,
  ModelSelectorEmpty,
  ModelSelectorGroup,
  ModelSelectorInput,
  ModelSelectorItem,
  ModelSelectorList,
  ModelSelectorName,
  ModelSelectorSeparator,
  ModelSelectorShortcut,
  ModelSelectorTrigger,
} from "./model-selector";

const meta = {
  title: "AI Elements/ModelSelector",
  component: ModelSelector,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
  },
} satisfies Meta<typeof ModelSelector>;

export default meta;
type Story = StoryObj<typeof meta>;

type ModelEntry = {
  id: string;
  name: string;
  provider: "anthropic" | "openai" | "google";
  shortcut?: string;
};

const ANTHROPIC_MODELS: ModelEntry[] = [
  { id: "claude-opus", name: "Claude Opus 4.8", provider: "anthropic", shortcut: "⌘1" },
  { id: "claude-sonnet", name: "Claude Sonnet 4.6", provider: "anthropic", shortcut: "⌘2" },
];

const MODELS: Record<string, ModelEntry[]> = {
  Anthropic: ANTHROPIC_MODELS,
  OpenAI: [
    { id: "gpt-5", name: "GPT-5", provider: "openai", shortcut: "⌘3" },
    { id: "gpt-5-mini", name: "GPT-5 Mini", provider: "openai" },
  ],
  Google: [{ id: "gemini-pro", name: "Gemini 2.5 Pro", provider: "google" }],
};

/**
 * A command-palette model picker. Click the trigger to open the dialog and
 * choose a model from grouped, searchable entries.
 */
export const Default: Story = {
  render: () => {
    const [selected, setSelected] = useState("claude-opus");
    const [open, setOpen] = useState(false);

    const groups = Object.entries(MODELS);

    return (
      <ModelSelector open={open} onOpenChange={setOpen}>
        <ModelSelectorTrigger asChild>
          <Button variant="outline">Select model</Button>
        </ModelSelectorTrigger>
        <ModelSelectorContent>
          <ModelSelectorInput placeholder="Search models..." />
          <ModelSelectorList>
            <ModelSelectorEmpty>No models found.</ModelSelectorEmpty>
            {groups.map(([group, models], index) => (
              <div key={group}>
                {index > 0 ? <ModelSelectorSeparator /> : null}
                <ModelSelectorGroup heading={group}>
                  {models.map((model) => (
                    <ModelSelectorItem
                      key={model.id}
                      value={`${group} ${model.name}`}
                      onSelect={() => {
                        setSelected(model.id);
                        setOpen(false);
                      }}
                    >
                      <ModelSelectorName>{model.name}</ModelSelectorName>
                      {selected === model.id ? (
                        <CheckIcon className="size-3.5 text-fg-mute" />
                      ) : null}
                      {model.shortcut ? (
                        <ModelSelectorShortcut>{model.shortcut}</ModelSelectorShortcut>
                      ) : null}
                    </ModelSelectorItem>
                  ))}
                </ModelSelectorGroup>
              </div>
            ))}
          </ModelSelectorList>
        </ModelSelectorContent>
      </ModelSelector>
    );
  },
};

/** The picker rendered already open, for inspecting the list without interaction. */
export const Open: Story = {
  render: () => (
    <ModelSelector defaultOpen>
      <ModelSelectorTrigger asChild>
        <Button variant="outline">Select model</Button>
      </ModelSelectorTrigger>
      <ModelSelectorContent>
        <ModelSelectorInput placeholder="Search models..." />
        <ModelSelectorList>
          <ModelSelectorEmpty>No models found.</ModelSelectorEmpty>
          <ModelSelectorGroup heading="Anthropic">
            {ANTHROPIC_MODELS.map((model) => (
              <ModelSelectorItem key={model.id} value={model.name}>
                <ModelSelectorName>{model.name}</ModelSelectorName>
                {model.shortcut ? (
                  <ModelSelectorShortcut>{model.shortcut}</ModelSelectorShortcut>
                ) : null}
              </ModelSelectorItem>
            ))}
          </ModelSelectorGroup>
        </ModelSelectorList>
      </ModelSelectorContent>
    </ModelSelector>
  ),
};
