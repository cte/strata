import type { Meta, StoryObj } from "@storybook/react-vite";
import { CheckIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  ModelSelector,
  ModelSelectorCollection,
  ModelSelectorCommand,
  ModelSelectorContent,
  ModelSelectorEmpty,
  ModelSelectorGroup,
  ModelSelectorGroupLabel,
  ModelSelectorInput,
  ModelSelectorItem,
  ModelSelectorList,
  ModelSelectorName,
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

interface ModelItem {
  id: string;
  name: string;
  shortcut?: string;
  search: string;
}

interface ModelGroup {
  label: string;
  items: ModelItem[];
}

function makeItem(label: string, item: Omit<ModelItem, "search">): ModelItem {
  return { ...item, search: `${label} ${item.name} ${item.id}` };
}

const GROUPS: ModelGroup[] = [
  {
    label: "Anthropic",
    items: [
      makeItem("Anthropic", { id: "claude-opus", name: "Claude Opus 4.8", shortcut: "⌘1" }),
      makeItem("Anthropic", { id: "claude-sonnet", name: "Claude Sonnet 4.6", shortcut: "⌘2" }),
    ],
  },
  {
    label: "OpenAI",
    items: [
      makeItem("OpenAI", { id: "gpt-5", name: "GPT-5", shortcut: "⌘3" }),
      makeItem("OpenAI", { id: "gpt-5-mini", name: "GPT-5 Mini" }),
    ],
  },
  {
    label: "Google",
    items: [makeItem("Google", { id: "gemini-pro", name: "Gemini 2.5 Pro" })],
  },
];

function ModelList({ selected, onSelect }: { selected: string; onSelect(id: string): void }) {
  return (
    <ModelSelectorCommand<ModelItem>
      items={GROUPS}
      itemToStringLabel={(item) => item.search}
      onValueChange={(item) => {
        if (item) {
          onSelect(item.id);
        }
      }}
    >
      <ModelSelectorInput placeholder="Search models..." />
      <ModelSelectorList<ModelGroup>>
        {(group) => (
          <ModelSelectorGroup key={group.label} items={group.items}>
            <ModelSelectorGroupLabel>{group.label}</ModelSelectorGroupLabel>
            <ModelSelectorCollection<ModelItem>>
              {(item) => (
                <ModelSelectorItem key={item.id} value={item}>
                  <ModelSelectorName>{item.name}</ModelSelectorName>
                  {selected === item.id ? <CheckIcon className="size-3.5 text-fg-mute" /> : null}
                  {item.shortcut ? (
                    <ModelSelectorShortcut>{item.shortcut}</ModelSelectorShortcut>
                  ) : null}
                </ModelSelectorItem>
              )}
            </ModelSelectorCollection>
          </ModelSelectorGroup>
        )}
      </ModelSelectorList>
      <ModelSelectorEmpty>No models found.</ModelSelectorEmpty>
    </ModelSelectorCommand>
  );
}

/**
 * A command-palette model picker. Click the trigger to open the dialog and
 * choose a model from grouped, searchable entries.
 */
export const Default: Story = {
  render: () => {
    const [selected, setSelected] = useState("claude-opus");
    const [open, setOpen] = useState(false);
    return (
      <ModelSelector open={open} onOpenChange={setOpen}>
        <ModelSelectorTrigger render={<Button variant="outline">Select model</Button>} />
        <ModelSelectorContent>
          <ModelList
            selected={selected}
            onSelect={(id) => {
              setSelected(id);
              setOpen(false);
            }}
          />
        </ModelSelectorContent>
      </ModelSelector>
    );
  },
};

/** The picker rendered already open, for inspecting the list without interaction. */
export const Open: Story = {
  render: () => (
    <ModelSelector defaultOpen>
      <ModelSelectorTrigger render={<Button variant="outline">Select model</Button>} />
      <ModelSelectorContent>
        <ModelList selected="claude-opus" onSelect={() => {}} />
      </ModelSelectorContent>
    </ModelSelector>
  ),
};
