import type { Meta, StoryObj } from "@storybook/react-vite";
import { TabsIndicator, TabsList, TabsPanel, TabsRoot, TabsTab } from "./tabs";

const meta = {
  title: "UI/Tabs",
  component: TabsRoot,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
  },
} satisfies Meta<typeof TabsRoot>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Built on `@base-ui/react/tabs`: panels and tabs are matched by `value`, the
 * active tab is styled with `data-[selected]`, and `TabsIndicator` rides the
 * `--active-tab-left` / `--active-tab-width` CSS vars under the active tab.
 */
export const Default: Story = {
  render: () => (
    <TabsRoot defaultValue="overview" className="w-96">
      <TabsList>
        <TabsTab value="overview">Overview</TabsTab>
        <TabsTab value="activity">Activity</TabsTab>
        <TabsTab value="settings">Settings</TabsTab>
        <TabsIndicator />
      </TabsList>
      <TabsPanel value="overview">
        <p className="text-sm text-fg-dim">
          A high-level summary of the current stratum and its recent indexing runs.
        </p>
      </TabsPanel>
      <TabsPanel value="activity">
        <p className="text-sm text-fg-dim">
          Connector pulls, raw-to-wiki indexing, and job activity reconstructed from the event log.
        </p>
      </TabsPanel>
      <TabsPanel value="settings">
        <p className="text-sm text-fg-dim">
          Tool profiles, triggers, and publication policy for this routine.
        </p>
      </TabsPanel>
    </TabsRoot>
  ),
};

/** A two-tab layout, the smallest useful shape. */
export const TwoTabs: Story = {
  render: () => (
    <TabsRoot defaultValue="mine" className="w-80">
      <TabsList>
        <TabsTab value="mine">Mine</TabsTab>
        <TabsTab value="theirs">Theirs</TabsTab>
        <TabsIndicator />
      </TabsList>
      <TabsPanel value="mine">
        <p className="text-sm text-fg-dim">Action items you committed to.</p>
      </TabsPanel>
      <TabsPanel value="theirs">
        <p className="text-sm text-fg-dim">Action items others owe you.</p>
      </TabsPanel>
    </TabsRoot>
  ),
};
