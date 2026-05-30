import { Cable, ListChecks, Unplug, X } from "lucide-react";
import type * as React from "react";
import { useCallback, useEffect, useState } from "react";
import { ConnectorOperationPanel } from "@/components/connector-operation-panel";
import { PageContainer, PageHeader } from "@/components/page-layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { NotionMcpToolsResult } from "@/lib/api";
import {
  useDisconnectNotionMcp,
  useListNotionMcpTools,
  useNotionMcpStatus,
  useStartNotionMcpAuth,
} from "@/lib/queries/connectors";
import {
  type ConnectorConfigDraft,
  useConnectorDefaultConfig,
} from "@/lib/useConnectorDefaultConfig";

export function ConnectorsNotionPage(): React.ReactElement {
  const [mcpTools, setMcpTools] = useState<NotionMcpToolsResult | null>(null);
  const [mcpNotice, setMcpNotice] = useState<{ tone: "ready" | "bad"; message: string } | null>(
    null,
  );
  const [pageId, setPageId] = useState("");
  const [mutationError, setMutationError] = useState<string | null>(null);

  const statusQuery = useNotionMcpStatus();
  const startAuthMutation = useStartNotionMcpAuth();
  const listToolsMutation = useListNotionMcpTools();
  const disconnectMutation = useDisconnectNotionMcp();

  const mcpStatus = statusQuery.data ?? null;
  const error = statusQuery.error ? messageOf(statusQuery.error) : mutationError;
  const isPending =
    startAuthMutation.isPending || listToolsMutation.isPending || disconnectMutation.isPending;

  const applyDefaultConfig = useCallback((config: ConnectorConfigDraft) => {
    setPageId(configString(config.pageId));
  }, []);
  const defaults = useConnectorDefaultConfig("notion", applyDefaultConfig);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const status = params.get("status");
    const message = params.get("message") ?? "";
    if (status === "ok" || status === "error") {
      setMcpNotice({ tone: status === "ok" ? "ready" : "bad", message });
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  function runMcp(action: "connect" | "tools" | "disconnect"): void {
    setMutationError(null);
    const onError = (cause: unknown) => setMutationError(messageOf(cause));
    if (action === "connect") {
      startAuthMutation.mutate(window.location.origin, {
        onSuccess: (next) => {
          if (next.authorizationUrl) {
            window.location.assign(next.authorizationUrl);
          } else {
            void statusQuery.refetch();
          }
        },
        onError,
      });
      return;
    }
    if (action === "tools") {
      listToolsMutation.mutate(undefined, {
        onSuccess: (next) => {
          setMcpTools(next);
          void statusQuery.refetch();
        },
        onError,
      });
      return;
    }
    disconnectMutation.mutate(undefined, {
      onSuccess: () => setMcpTools(null),
      onError,
    });
  }

  const pageConfig = pageId.trim() === "" ? {} : { pageId: pageId.trim() };

  return (
    <PageContainer width="default">
      <PageHeader
        back={{ to: "/connectors", label: "Connectors" }}
        title="Notion"
        description={
          <>
            OAuth path through Notion’s hosted MCP server. Strata stores refresh credentials locally
            under <span className="font-mono text-fg">.strata/secrets/</span>.
          </>
        }
      />

      <div className="rounded-md border border-hairline bg-surface p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium tracking-tight text-fg">Notion MCP</p>
            {mcpStatus ? <p className="mt-1 text-xs text-fg-dim">{mcpStatus.message}</p> : null}
          </div>
          <Badge
            tone={mcpStatus?.authenticated ? "ready" : "muted"}
            pulse={Boolean(mcpStatus?.authenticated)}
          >
            {(mcpStatus?.state ?? "unknown").replace("_", " ")}
          </Badge>
        </div>

        {mcpNotice ? (
          <McpCallbackNotice notice={mcpNotice} onDismiss={() => setMcpNotice(null)} />
        ) : null}

        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            disabled={isPending}
            onClick={() => runMcp("connect")}
            variant="secondary"
            size="sm"
          >
            <Cable size={13} strokeWidth={2} />
            Connect MCP
          </Button>
          <Button
            disabled={isPending || !mcpStatus?.authenticated}
            onClick={() => runMcp("tools")}
            variant="secondary"
            size="sm"
          >
            <ListChecks size={13} strokeWidth={2} />
            List tools
          </Button>
          <Button
            disabled={isPending || !mcpStatus?.authenticated}
            onClick={() => runMcp("disconnect")}
            variant="secondary"
            size="sm"
          >
            <Unplug size={13} strokeWidth={2} />
            Disconnect
          </Button>
        </div>

        {mcpTools ? <McpToolsBlock result={mcpTools} /> : null}
      </div>

      <ConnectorOperationPanel
        connector="notion"
        title="Page snapshot"
        description={
          <>
            Pull one Notion page into <span className="font-mono text-fg">wiki/raw/notion/</span>,
            then optionally create curated project/source pages and refresh retrieval.
          </>
        }
        runTitle="Pull Notion page"
        config={pageConfig}
        canRun={pageId.trim() !== ""}
        disabledReason={
          pageId.trim() === ""
            ? "Provide a Notion page ID or URL. Page snapshots use NOTION_TOKEN."
            : "Page snapshots use NOTION_TOKEN; Notion MCP is available separately."
        }
        defaults={{
          label: "Saved page defaults",
          profileLabel: defaults.defaultProfile?.label ?? null,
          updatedAt: defaults.defaultProfile?.updatedAt ?? null,
          error: defaults.error,
          isLoading: defaults.isPending,
          canLoad: defaults.defaultProfile !== null,
          canSave: pageId.trim() !== "",
          onLoad: defaults.loadDefault,
          onSave: () =>
            defaults.saveDefault({
              id: "default",
              label: "Notion page snapshot defaults",
              config: pageConfig,
            }),
        }}
      >
        <label className="block space-y-1.5">
          <span className="text-xs text-fg-dim">Page ID or URL</span>
          <Input
            value={pageId}
            onChange={(event) => setPageId(event.target.value)}
            placeholder="https://www.notion.so/workspace/Page-..."
            spellCheck={false}
          />
        </label>
      </ConnectorOperationPanel>

      {error ? (
        <div className="rounded-md border border-bad/40 bg-bad/[0.06] p-3">
          <p className="font-mono text-xs text-bad">Operation failed</p>
          <p className="mt-1 text-sm text-fg-dim">{error}</p>
        </div>
      ) : null}
    </PageContainer>
  );
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
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

function McpCallbackNotice({
  notice,
  onDismiss,
}: {
  notice: { tone: "ready" | "bad"; message: string };
  onDismiss: () => void;
}): React.ReactElement {
  const isReady = notice.tone === "ready";
  return (
    <div
      className={`mt-3 flex items-start justify-between gap-3 rounded-md border p-3 ${
        isReady ? "border-good/30 bg-accent-soft" : "border-bad/40 bg-bad/[0.06]"
      }`}
    >
      <div>
        <p className={`font-mono text-xs ${isReady ? "text-good" : "text-bad"}`}>
          {isReady ? "connected" : "connection failed"}
        </p>
        <p className="mt-1 text-sm text-fg-dim">{notice.message}</p>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="-mr-1 -mt-1 rounded-sm p-1 text-fg-mute transition-colors duration-150 hover:bg-surface-2 hover:text-fg"
      >
        <X size={12} strokeWidth={2} />
      </button>
    </div>
  );
}

function McpToolsBlock({ result }: { result: NotionMcpToolsResult }): React.ReactElement {
  return (
    <div className="mt-3 rounded-md border border-hairline bg-surface-2 p-3">
      <p className="font-mono text-xs text-fg">{result.tools.length} MCP tools available</p>
      <ul className="mt-2 max-h-44 space-y-2 overflow-auto pr-1">
        {result.tools.map((tool) => (
          <li key={tool.name}>
            <p className="font-mono text-xs text-fg">{tool.name}</p>
            {tool.description ? (
              <p className="mt-0.5 line-clamp-2 text-xs text-fg-dim">{tool.description}</p>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
