import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  Terminal,
  TerminalActions,
  TerminalClearButton,
  TerminalContent,
  TerminalCopyButton,
  TerminalHeader,
  TerminalStatus,
  TerminalTitle,
} from "./terminal";

const SAMPLE_OUTPUT = [
  "$ bun run strata jobs list",
  "",
  "Scanning registered jobs...",
  "  connector.pull            ready",
  "  raw.index                 ready",
  "  wiki.search-index.refresh ready",
  "  wiki.hygiene              ready",
  "  maintenance.run           ready",
  "",
  "5 jobs registered.",
  "Done in 0.42s.",
].join("\n");

const meta = {
  title: "AI Elements/Terminal",
  component: Terminal,
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
  },
} satisfies Meta<typeof Terminal>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A finished command run with a title, copy action, and clear action. */
export const Default: Story = {
  args: { output: SAMPLE_OUTPUT },
  render: () => (
    <Terminal className="w-[640px]" onClear={() => {}} output={SAMPLE_OUTPUT}>
      <TerminalHeader>
        <TerminalTitle>strata jobs list</TerminalTitle>
        <div className="flex items-center gap-1">
          <TerminalStatus />
          <TerminalActions>
            <TerminalCopyButton />
            <TerminalClearButton />
          </TerminalActions>
        </div>
      </TerminalHeader>
      <TerminalContent />
    </Terminal>
  ),
};

/** A live run: the status row appears and a cursor pulses while streaming. */
export const Streaming: Story = {
  args: { output: SAMPLE_OUTPUT, isStreaming: true },
  render: () => (
    <Terminal className="w-[640px]" isStreaming onClear={() => {}} output={SAMPLE_OUTPUT}>
      <TerminalHeader>
        <TerminalTitle>strata jobs list</TerminalTitle>
        <div className="flex items-center gap-1">
          <TerminalStatus>Running…</TerminalStatus>
          <TerminalActions>
            <TerminalCopyButton />
            <TerminalClearButton />
          </TerminalActions>
        </div>
      </TerminalHeader>
      <TerminalContent />
    </Terminal>
  ),
};

/** With no `onClear`, the clear button hides itself automatically. */
export const CopyOnly: Story = {
  args: { output: SAMPLE_OUTPUT },
  render: () => (
    <Terminal className="w-[640px]" output={SAMPLE_OUTPUT}>
      <TerminalHeader>
        <TerminalTitle />
        <div className="flex items-center gap-1">
          <TerminalStatus />
          <TerminalActions>
            <TerminalCopyButton />
          </TerminalActions>
        </div>
      </TerminalHeader>
      <TerminalContent />
    </Terminal>
  ),
};
