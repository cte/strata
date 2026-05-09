import { Link } from "@tanstack/react-router";
import { ArrowLeft, Cable, ListChecks, Unplug, X } from "lucide-react";
import type * as React from "react";
import { useEffect, useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  disconnectNotionMcp,
  getNotionMcpStatus,
  listNotionMcpTools,
  type NotionMcpStatus,
  type NotionMcpToolsResult,
  startNotionMcpAuth,
} from "@/lib/api";

export function ConnectorsNotionPage(): React.ReactElement {
  const [mcpStatus, setMcpStatus] = useState<NotionMcpStatus | null>(null);
  const [mcpTools, setMcpTools] = useState<NotionMcpToolsResult | null>(null);
  const [mcpNotice, setMcpNotice] = useState<{ tone: "ready" | "bad"; message: string } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const status = params.get("status");
    const message = params.get("message") ?? "";
    if (status === "ok" || status === "error") {
      setMcpNotice({ tone: status === "ok" ? "ready" : "bad", message });
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    getNotionMcpStatus().then(
      (next) => {
        if (!cancelled) {
          setMcpStatus(next);
        }
      },
      (cause: unknown) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  function runMcp(action: "connect" | "tools" | "disconnect"): void {
    setError(null);
    startTransition(async () => {
      try {
        if (action === "connect") {
          const next = await startNotionMcpAuth(window.location.origin);
          if (next.authorizationUrl) {
            window.location.assign(next.authorizationUrl);
            return;
          }
          setMcpStatus(await getNotionMcpStatus());
          return;
        }
        if (action === "tools") {
          setMcpTools(await listNotionMcpTools());
          setMcpStatus(await getNotionMcpStatus());
          return;
        }
        setMcpStatus(await disconnectNotionMcp());
        setMcpTools(null);
      } catch (cause: unknown) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    });
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <BackLink />

      <header>
        <h1 className="text-[15px] font-medium tracking-tight text-[var(--fg)]">Notion</h1>
        <p className="mt-1 text-[13px] text-[var(--fg-dim)]">
          OAuth path through Notion’s hosted MCP server. Strata stores refresh credentials locally
          under <span className="font-mono text-[var(--fg)]">.strata/secrets/</span>.
        </p>
      </header>

      <div className="rounded-md border border-[var(--hairline)] bg-[var(--surface)] p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[13px] font-medium tracking-tight text-[var(--fg)]">Notion MCP</p>
            {mcpStatus ? (
              <p className="mt-1 text-[12px] text-[var(--fg-dim)]">{mcpStatus.message}</p>
            ) : null}
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

      {error ? (
        <div className="rounded-md border border-[var(--bad)]/40 bg-[var(--bad)]/[0.06] p-3">
          <p className="font-mono text-[12px] text-[var(--bad)]">Operation failed</p>
          <p className="mt-1 text-[13px] text-[var(--fg-dim)]">{error}</p>
        </div>
      ) : null}
    </div>
  );
}

function BackLink(): React.ReactElement {
  return (
    <Link
      to="/connectors"
      className="group inline-flex items-center gap-1 text-[12px] text-[var(--fg-mute)] transition-colors duration-150 hover:text-[var(--fg-dim)]"
    >
      <ArrowLeft
        size={12}
        strokeWidth={1.75}
        className="transition-transform duration-150 group-hover:-translate-x-0.5"
      />
      Connectors
    </Link>
  );
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
        isReady
          ? "border-[var(--good)]/30 bg-[var(--accent-soft)]"
          : "border-[var(--bad)]/40 bg-[var(--bad)]/[0.06]"
      }`}
    >
      <div>
        <p
          className={`font-mono text-[12px] ${
            isReady ? "text-[var(--good)]" : "text-[var(--bad)]"
          }`}
        >
          {isReady ? "connected" : "connection failed"}
        </p>
        <p className="mt-1 text-[13px] text-[var(--fg-dim)]">{notice.message}</p>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="-mr-1 -mt-1 rounded-sm p-1 text-[var(--fg-mute)] transition-colors duration-150 hover:bg-[var(--surface-2)] hover:text-[var(--fg)]"
      >
        <X size={12} strokeWidth={2} />
      </button>
    </div>
  );
}

function McpToolsBlock({ result }: { result: NotionMcpToolsResult }): React.ReactElement {
  return (
    <div className="mt-3 rounded-md border border-[var(--hairline)] bg-[var(--surface-2)] p-3">
      <p className="font-mono text-[12px] text-[var(--fg)]">
        {result.tools.length} MCP tools available
      </p>
      <ul className="mt-2 max-h-44 space-y-2 overflow-auto pr-1">
        {result.tools.map((tool) => (
          <li key={tool.name}>
            <p className="font-mono text-[12px] text-[var(--fg)]">{tool.name}</p>
            {tool.description ? (
              <p className="mt-0.5 line-clamp-2 text-[12px] text-[var(--fg-dim)]">
                {tool.description}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
