import { Link } from "@tanstack/react-router";
import { ArrowLeft, Plus, RefreshCw, Save, Trash2 } from "lucide-react";
import type * as React from "react";
import { useEffect, useMemo, useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";

import {
  deleteMcpSettings,
  getMcpSettingsStatus,
  listMcpTools,
  type McpServerStatus,
  type McpSettingsStatus,
  type McpToolSummary,
  updateMcpSettings,
} from "@/lib/api";

export function SettingsMcpsPage(): React.ReactElement {
  const [status, setStatus] = useState<McpSettingsStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getMcpSettingsStatus().then(
      (next) => {
        if (!cancelled) {
          setStatus(next);
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

  async function applyUpdate(input: Parameters<typeof updateMcpSettings>[0]): Promise<void> {
    setError(null);
    setNotice(null);
    try {
      setStatus(await updateMcpSettings(input));
      setNotice("MCP settings saved.");
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function applyDelete(slug: string): Promise<void> {
    setError(null);
    setNotice(null);
    try {
      setStatus(await deleteMcpSettings(slug));
      setNotice("MCP server removed.");
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <BackLink />

      <header>
        <h1 className="text-[15px] font-medium tracking-tight text-[var(--fg)]">MCP servers</h1>
        <p className="mt-1 text-[13px] text-[var(--fg-dim)]">
          Manage local Model Context Protocol tool servers. Secrets are stored locally in
          <span className="font-mono text-[var(--fg)]"> .strata/secrets/mcp-servers.json</span>
          and are never returned to the browser.
        </p>
      </header>

      {notice ? (
        <div className="rounded-md border border-[var(--good)]/30 bg-[var(--accent-soft)] p-3 text-[13px] text-[var(--fg-dim)]">
          {notice}
        </div>
      ) : null}

      <NewMcpServerCard onCreate={applyUpdate} />

      <div className="space-y-3">
        {(status?.servers ?? fallbackServers()).map((server) => (
          <McpServerCard
            key={server.slug}
            server={server}
            onDelete={applyDelete}
            onUpdate={applyUpdate}
          />
        ))}
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

function NewMcpServerCard({
  onCreate,
}: {
  onCreate(input: Parameters<typeof updateMcpSettings>[0]): Promise<void>;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [slug, setSlug] = useState("");
  const [serverUrl, setServerUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [isPending, startTransition] = useTransition();

  function create(): void {
    startTransition(async () => {
      await onCreate({
        slug,
        displayName,
        serverUrl,
        ...(apiKey.trim() === "" ? {} : { apiKey }),
        enabled: false,
      });
      setOpen(false);
      setDisplayName("");
      setSlug("");
      setServerUrl("");
      setApiKey("");
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="secondary">
          <Plus size={13} strokeWidth={2} />
          Add MCP server
        </Button>
      </DialogTrigger>
      <DialogContent className="border-[var(--hairline)] bg-[var(--bg-elev)] text-[var(--fg)]">
        <DialogHeader>
          <DialogTitle>Add MCP server</DialogTitle>
          <DialogDescription>
            Add a Streamable HTTP MCP server. Tools can be refreshed after saving.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <LabeledInput label="Display name" value={displayName} onChange={setDisplayName} />
          <LabeledInput label="Slug" value={slug} onChange={setSlug} placeholder="linear" />
          <LabeledInput
            label="Server URL"
            value={serverUrl}
            onChange={setServerUrl}
            placeholder="https://example.com/mcp"
          />
          <LabeledInput
            label="API key (optional)"
            value={apiKey}
            onChange={setApiKey}
            placeholder="Optional API key sent as x-api-key"
            type="password"
          />
        </div>
        <DialogFooter>
          <Button disabled={isPending} onClick={() => setOpen(false)} size="sm" variant="ghost">
            Cancel
          </Button>
          <Button
            disabled={
              isPending ||
              slug.trim() === "" ||
              displayName.trim() === "" ||
              serverUrl.trim() === ""
            }
            onClick={create}
            size="sm"
            variant="secondary"
          >
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function McpServerCard({
  server,
  onUpdate,
  onDelete,
}: {
  server: McpServerStatus;
  onUpdate(input: Parameters<typeof updateMcpSettings>[0]): Promise<void>;
  onDelete(slug: string): Promise<void>;
}): React.ReactElement {
  const [displayName, setDisplayName] = useState(server.displayName);
  const [serverUrl, setServerUrl] = useState(server.serverUrl);
  const [apiKey, setApiKey] = useState("");
  const [clearApiKey, setClearApiKey] = useState(false);
  const [selectedTools, setSelectedTools] = useState<string[]>(server.selectedTools);
  const [tools, setTools] = useState<McpToolSummary[] | null>(null);
  const [toolError, setToolError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const canDelete = server.slug !== "exa";

  useEffect(() => {
    setDisplayName(server.displayName);
    setServerUrl(server.serverUrl);
    setSelectedTools(server.selectedTools);
    setApiKey("");
    setClearApiKey(false);
  }, [server]);

  const knownToolNames = useMemo(
    () => tools?.map((tool) => tool.name) ?? server.selectedTools,
    [server.selectedTools, tools],
  );

  function loadTools(): void {
    setToolError(null);
    startTransition(async () => {
      try {
        const next = await listMcpTools(server.slug, serverUrl);
        setTools(next);
        if (selectedTools.length === 0) {
          setSelectedTools(next.map((tool) => tool.name));
        }
      } catch (cause: unknown) {
        setToolError(cause instanceof Error ? cause.message : String(cause));
      }
    });
  }

  function save(partial: { enabled?: boolean } = {}): void {
    startTransition(async () => {
      await onUpdate({
        slug: server.slug,
        displayName,
        serverUrl,
        selectedTools,
        ...(apiKey.trim() === "" ? {} : { apiKey }),
        ...(clearApiKey ? { clearApiKey: true } : {}),
        ...partial,
      });
    });
  }

  function remove(): void {
    if (!canDelete) {
      return;
    }
    startTransition(async () => {
      await onDelete(server.slug);
    });
  }

  return (
    <div className="rounded-md border border-[var(--hairline)] bg-[var(--surface)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[13px] font-medium tracking-tight text-[var(--fg)]">
            {server.displayName}
          </p>
          <p className="mt-1 text-[12px] text-[var(--fg-dim)]">{server.message}</p>
          <p className="mt-1 font-mono text-[11px] text-[var(--fg-mute)]">mcp.{server.slug}.*</p>
          {server.updatedAt ? (
            <p className="mt-1 font-mono text-[11px] text-[var(--fg-mute)]">
              updated {new Date(server.updatedAt).toISOString()}
            </p>
          ) : null}
        </div>
        <Badge tone={server.enabled ? "ready" : "muted"} pulse={server.enabled}>
          {server.state}
        </Badge>
      </div>

      <div className="mt-4 grid gap-3">
        <LabeledInput label="Display name" value={displayName} onChange={setDisplayName} />
        <LabeledInput label="Server URL" value={serverUrl} onChange={setServerUrl} />
        <LabeledInput
          label={`API key ${server.apiKeyConfigured ? "(configured)" : "(optional)"}`}
          value={apiKey}
          onChange={setApiKey}
          placeholder={
            server.apiKeyConfigured ? "Leave blank to keep existing key" : "Optional API key"
          }
          type="password"
        />
        {server.apiKeyConfigured ? (
          <label className="flex items-center gap-2 text-[12px] text-[var(--fg-dim)]">
            <input
              checked={clearApiKey}
              onChange={(event) => setClearApiKey(event.currentTarget.checked)}
              type="checkbox"
            />
            Clear saved API key on save
          </label>
        ) : null}
      </div>

      <div className="mt-4 rounded-md border border-[var(--hairline)] bg-[var(--surface-2)] p-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[12px] font-medium text-[var(--fg)]">Tools</p>
            <p className="mt-1 text-[12px] text-[var(--fg-dim)]">
              Select which remote MCP tools Strata exposes as read-only agent tools.
            </p>
          </div>
          <Button disabled={isPending} onClick={loadTools} size="sm" variant="ghost">
            <RefreshCw size={13} strokeWidth={2} />
            Refresh
          </Button>
        </div>

        <div className="mt-3 space-y-2">
          {knownToolNames.length === 0 ? (
            <p className="text-[12px] text-[var(--fg-mute)]">
              Refresh tools to populate this list.
            </p>
          ) : (
            knownToolNames.map((name) => {
              const summary = tools?.find((tool) => tool.name === name);
              return (
                <label
                  key={name}
                  className="flex items-start gap-2 text-[12px] text-[var(--fg-dim)]"
                >
                  <input
                    checked={selectedTools.includes(name)}
                    onChange={(event) => {
                      setSelectedTools((current) =>
                        event.currentTarget.checked
                          ? [...new Set([...current, name])]
                          : current.filter((tool) => tool !== name),
                      );
                    }}
                    type="checkbox"
                  />
                  <span>
                    <span className="font-mono text-[var(--fg)]">{name}</span>
                    {summary?.description ? <span> — {summary.description}</span> : null}
                  </span>
                </label>
              );
            })
          )}
        </div>

        {toolError ? <p className="mt-3 text-[12px] text-[var(--bad)]">{toolError}</p> : null}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-[12px] text-[var(--fg-dim)]">
          <Switch
            checked={server.enabled}
            disabled={isPending}
            onCheckedChange={(enabled) => save({ enabled })}
          />
          <span>{server.enabled ? "Enabled" : "Disabled"}</span>
        </label>
        <div className="flex flex-wrap gap-2">
          {canDelete ? (
            <Button disabled={isPending} onClick={remove} size="sm" variant="ghost">
              <Trash2 size={13} strokeWidth={2} />
              Remove
            </Button>
          ) : null}
          <Button disabled={isPending} onClick={() => save()} size="sm" variant="secondary">
            <Save size={13} strokeWidth={2} />
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}

function LabeledInput({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange(value: string): void;
  placeholder?: string;
  type?: "password" | "text";
}): React.ReactElement {
  return (
    <label className="grid gap-1.5 text-[12px] text-[var(--fg-dim)]">
      {label}
      <input
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
        placeholder={placeholder}
        type={type}
        className="h-9 rounded-md border border-[var(--hairline)] bg-[var(--bg)] px-3 font-mono text-[12px] text-[var(--fg)] outline-none focus:border-[var(--accent)]"
      />
    </label>
  );
}

function BackLink(): React.ReactElement {
  return (
    <Link
      to="/chat"
      className="group inline-flex items-center gap-1 text-[12px] text-[var(--fg-mute)] transition-colors duration-150 hover:text-[var(--fg-dim)]"
    >
      <ArrowLeft
        size={12}
        strokeWidth={1.75}
        className="transition-transform duration-150 group-hover:-translate-x-0.5"
      />
      Chat
    </Link>
  );
}

function fallbackServers(): McpServerStatus[] {
  return [
    {
      slug: "exa",
      displayName: "Exa",
      serverUrl: "https://mcp.exa.ai/mcp",
      enabled: false,
      selectedTools: ["web_search_exa", "web_fetch_exa"],
      headerNames: [],
      apiKeyConfigured: false,
      state: "disabled",
      message: "Checking Exa MCP settings...",
    },
  ];
}
