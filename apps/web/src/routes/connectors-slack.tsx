import type * as React from "react";
import { useCallback, useState } from "react";
import { ConnectorOperationPanel } from "@/components/connector-operation-panel";
import { PageContainer, PageHeader } from "@/components/page-layout";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useConnectors } from "@/lib/queries/connectors";
import {
  type ConnectorConfigDraft,
  useConnectorDefaultConfig,
} from "@/lib/useConnectorDefaultConfig";

export function ConnectorsSlackPage(): React.ReactElement {
  const connectorsQuery = useConnectors();
  const connector = connectorsQuery.data?.find((c) => c.name === "slack") ?? null;
  const [since, setSince] = useState("");
  const [allHistory, setAllHistory] = useState(false);
  const [channels, setChannels] = useState("");
  const [channelRegex, setChannelRegex] = useState("");
  const [includePrivate, setIncludePrivate] = useState(false);
  const [includeDms, setIncludeDms] = useState(false);
  const [includeBotMessages, setIncludeBotMessages] = useState(false);
  const [lookbackMinutes, setLookbackMinutes] = useState("60");
  const [maxChannels, setMaxChannels] = useState("25");
  const [maxMessagesPerChannel, setMaxMessagesPerChannel] = useState("150");
  const [maxThreads, setMaxThreads] = useState("100");
  const applyDefaultConfig = useCallback((config: ConnectorConfigDraft) => {
    setSince(configString(config.since));
    setAllHistory(configBoolean(config.allHistory, false));
    setChannels(configString(config.channels));
    setChannelRegex(configString(config.channelRegex));
    setIncludePrivate(configBoolean(config.includePrivateChannels, false));
    setIncludeDms(configBoolean(config.includeDms, false));
    setIncludeBotMessages(configBoolean(config.includeBotMessages, false));
    setLookbackMinutes(configString(config.lookbackMinutes, "60"));
    setMaxChannels(configString(config.maxChannels, "25"));
    setMaxMessagesPerChannel(configString(config.maxMessagesPerChannel, "150"));
    setMaxThreads(configString(config.maxThreads, "100"));
  }, []);
  const defaults = useConnectorDefaultConfig("slack", applyDefaultConfig);

  const syncConfig = compactSlackConfig({
    allHistory,
    channelRegex,
    channels,
    includeBotMessages,
    includeDms,
    includePrivate,
    lookbackMinutes,
    maxChannels,
    maxMessagesPerChannel,
    maxThreads,
    since,
  });

  return (
    <PageContainer width="default">
      <PageHeader
        back={{ to: "/connectors", label: "Connectors" }}
        title="Slack"
        description={
          <>
            Capture Slack channels and threads into{" "}
            <span className="font-mono text-fg">wiki/raw/slack/</span> through the shared
            checkpointed connector runner.
          </>
        }
        actions={
          <Badge tone={connector?.configured ? "warning" : "muted"}>
            {(connector?.state ?? "not_configured").replace("_", " ")}
          </Badge>
        }
      />

      <div className="rounded-md border border-hairline bg-surface p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium tracking-tight text-fg">Token state</p>
            <p className="mt-1 text-xs text-fg-dim">
              {connector?.message ?? "Loading Slack connector status."}
            </p>
          </div>
          <Badge
            tone={connector?.configured ? "ready" : "muted"}
            pulse={connector?.configured === true}
          >
            {(connector?.state ?? "unknown").replace("_", " ")}
          </Badge>
        </div>
      </div>

      <ConnectorOperationPanel
        connector="slack"
        title="One-off sync"
        description={
          <>
            Run the checkpointed Slack connector now, capture material threads into{" "}
            <span className="font-mono text-fg">wiki/raw/slack/</span>, then optionally index them
            into source-backed wiki pages.
          </>
        }
        runTitle="Sync Slack conversations"
        config={syncConfig}
        canRun={connector?.configured === true}
        disabledReason={
          connector?.configured
            ? "First sync needs a since timestamp or all history. Existing checkpoints can run incrementally."
            : "Set SLACK_USER_TOKEN or SLACK_BOT_TOKEN before syncing."
        }
        defaults={{
          label: "Saved sync defaults",
          profileLabel: defaults.defaultProfile?.label ?? null,
          updatedAt: defaults.defaultProfile?.updatedAt ?? null,
          error: defaults.error,
          isLoading: defaults.isPending,
          canLoad: defaults.defaultProfile !== null,
          canSave: true,
          onLoad: defaults.loadDefault,
          onSave: () =>
            defaults.saveDefault({
              id: "default",
              label: "Slack sync defaults",
              config: syncConfig,
            }),
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1.5">
            <span className="text-xs text-fg-dim">Since</span>
            <Input
              value={since}
              onChange={(event) => setSince(event.target.value)}
              placeholder="2026-05-01T00:00:00.000Z"
              spellCheck={false}
            />
          </label>
          <label className="space-y-1.5">
            <span className="text-xs text-fg-dim">Channels</span>
            <Input
              value={channels}
              onChange={(event) => setChannels(event.target.value)}
              placeholder="general,engineering,C0123456789"
              spellCheck={false}
            />
          </label>
          <label className="space-y-1.5">
            <span className="text-xs text-fg-dim">Channel regex</span>
            <Input
              value={channelRegex}
              onChange={(event) => setChannelRegex(event.target.value)}
              placeholder="^(eng|product)-"
              spellCheck={false}
            />
          </label>
          <label className="space-y-1.5">
            <span className="text-xs text-fg-dim">Lookback minutes</span>
            <Input
              inputMode="numeric"
              value={lookbackMinutes}
              onChange={(event) => setLookbackMinutes(event.target.value)}
            />
          </label>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <label className="space-y-1.5">
            <span className="text-xs text-fg-dim">Max channels</span>
            <Input
              inputMode="numeric"
              value={maxChannels}
              onChange={(event) => setMaxChannels(event.target.value)}
            />
          </label>
          <label className="space-y-1.5">
            <span className="text-xs text-fg-dim">Max messages/channel</span>
            <Input
              inputMode="numeric"
              value={maxMessagesPerChannel}
              onChange={(event) => setMaxMessagesPerChannel(event.target.value)}
            />
          </label>
          <label className="space-y-1.5">
            <span className="text-xs text-fg-dim">Max threads</span>
            <Input
              inputMode="numeric"
              value={maxThreads}
              onChange={(event) => setMaxThreads(event.target.value)}
            />
          </label>
        </div>

        <div className="grid gap-2 border-t border-hairline pt-3 sm:grid-cols-2">
          <Toggle
            checked={allHistory}
            label="Allow all-history backfill"
            onChange={setAllHistory}
          />
          <Toggle
            checked={includePrivate}
            label="Include private channels"
            onChange={setIncludePrivate}
          />
          <Toggle checked={includeDms} label="Include DMs" onChange={setIncludeDms} />
          <Toggle
            checked={includeBotMessages}
            label="Include bot messages"
            onChange={setIncludeBotMessages}
          />
        </div>
      </ConnectorOperationPanel>
    </PageContainer>
  );
}

function Toggle({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange(value: boolean): void;
}): React.ReactElement {
  return (
    <label className="flex items-center gap-2 text-xs text-fg-dim">
      <input
        checked={checked}
        onChange={(event) => onChange(event.currentTarget.checked)}
        type="checkbox"
      />
      {label}
    </label>
  );
}

function configString(value: unknown, fallback = ""): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return fallback;
}

function configBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function compactSlackConfig(input: {
  allHistory: boolean;
  channelRegex: string;
  channels: string;
  includeBotMessages: boolean;
  includeDms: boolean;
  includePrivate: boolean;
  lookbackMinutes: string;
  maxChannels: string;
  maxMessagesPerChannel: string;
  maxThreads: string;
  since: string;
}): Record<string, string | boolean> {
  return compactConfig({
    mode: "sync",
    since: input.allHistory ? "" : input.since,
    allHistory: input.allHistory,
    channels: input.channels,
    channelRegex: input.channelRegex,
    includePrivateChannels: input.includePrivate,
    includeDms: input.includeDms,
    includeBotMessages: input.includeBotMessages,
    lookbackMinutes: input.lookbackMinutes,
    maxChannels: input.maxChannels,
    maxMessagesPerChannel: input.maxMessagesPerChannel,
    maxThreads: input.maxThreads,
  });
}

function compactConfig(input: Record<string, string | boolean>): Record<string, string | boolean> {
  const output: Record<string, string | boolean> = {};
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed !== "") {
        output[key] = trimmed;
      }
      continue;
    }
    output[key] = value;
  }
  return output;
}
