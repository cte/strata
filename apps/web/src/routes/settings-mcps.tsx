import { useForm } from "@tanstack/react-form";
import { Plus, RefreshCw, Save, Trash2 } from "lucide-react";
import type * as React from "react";
import { useEffect, useMemo, useState, useTransition } from "react";
import { FormField, fieldError, hasError } from "@/components/form";
import { PageContainer, PageHeader } from "@/components/page-layout";
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
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import type { McpServerStatus, McpSettingsUpdateInput, McpToolSummary } from "@/lib/api";
import { requiredText, urlText } from "@/lib/forms/zod";
import {
  useDeleteMcpSettings,
  useListMcpTools,
  useMcpSettings,
  useUpdateMcpSettings,
} from "@/lib/queries/mcps";

export function SettingsMcpsPage(): React.ReactElement {
  const statusQuery = useMcpSettings();
  const updateMutation = useUpdateMcpSettings();
  const deleteMutation = useDeleteMcpSettings();
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const status = statusQuery.data ?? null;
  const error = statusQuery.error ? messageOf(statusQuery.error) : mutationError;

  async function applyUpdate(input: McpSettingsUpdateInput): Promise<void> {
    setMutationError(null);
    setNotice(null);
    try {
      await updateMutation.mutateAsync(input);
      setNotice("MCP settings saved.");
    } catch (cause: unknown) {
      setMutationError(messageOf(cause));
    }
  }

  async function applyDelete(slug: string): Promise<void> {
    setMutationError(null);
    setNotice(null);
    try {
      await deleteMutation.mutateAsync(slug);
      setNotice("MCP server removed.");
    } catch (cause: unknown) {
      setMutationError(messageOf(cause));
    }
  }

  return (
    <PageContainer width="narrow">
      <PageHeader
        title="MCP servers"
        description={
          <>
            Manage local Model Context Protocol tool servers. Secrets are stored locally in
            <span className="font-mono text-fg"> .strata/secrets/mcp-servers.json</span>
            and are never returned to the browser.
          </>
        }
      />

      {notice ? (
        <div className="rounded-md border border-good/30 bg-accent-soft p-3 text-sm text-fg-dim">
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
        <div className="rounded-md border border-bad/40 bg-bad/[0.06] p-3">
          <p className="font-mono text-xs text-bad">Operation failed</p>
          <p className="mt-1 text-sm text-fg-dim">{error}</p>
        </div>
      ) : null}
    </PageContainer>
  );
}

function NewMcpServerCard({
  onCreate,
}: {
  onCreate(input: McpSettingsUpdateInput): Promise<void>;
}): React.ReactElement {
  const [open, setOpen] = useState(false);

  const form = useForm({
    defaultValues: { displayName: "", slug: "", serverUrl: "", apiKey: "" },
    onSubmit: async ({ value, formApi }) => {
      await onCreate({
        slug: value.slug.trim(),
        displayName: value.displayName.trim(),
        serverUrl: value.serverUrl.trim(),
        ...(value.apiKey.trim() === "" ? {} : { apiKey: value.apiKey }),
        enabled: false,
      });
      setOpen(false);
      formApi.reset();
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          form.reset();
        }
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="secondary">
          <Plus size={13} strokeWidth={2} />
          Add MCP server
        </Button>
      </DialogTrigger>
      <DialogContent className="border-hairline bg-bg-elev text-fg">
        <DialogHeader>
          <DialogTitle>Add MCP server</DialogTitle>
          <DialogDescription>
            Add a Streamable HTTP MCP server. Tools can be refreshed after saving.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void form.handleSubmit();
          }}
          className="grid gap-3"
        >
          <form.Field
            name="displayName"
            validators={{
              onBlur: requiredText("Display name"),
              onChange: requiredText("Display name"),
            }}
          >
            {(field) => (
              <FormField label="Display name" error={fieldError(field.state.meta)}>
                <Input
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                  aria-invalid={hasError(field.state.meta)}
                />
              </FormField>
            )}
          </form.Field>
          <form.Field
            name="slug"
            validators={{ onBlur: requiredText("Slug"), onChange: requiredText("Slug") }}
          >
            {(field) => (
              <FormField label="Slug" error={fieldError(field.state.meta)}>
                <Input
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                  aria-invalid={hasError(field.state.meta)}
                  placeholder="linear"
                />
              </FormField>
            )}
          </form.Field>
          <form.Field
            name="serverUrl"
            validators={{ onBlur: urlText("Server URL"), onChange: urlText("Server URL") }}
          >
            {(field) => (
              <FormField label="Server URL" error={fieldError(field.state.meta)}>
                <Input
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                  aria-invalid={hasError(field.state.meta)}
                  placeholder="https://example.com/mcp"
                />
              </FormField>
            )}
          </form.Field>
          <form.Field name="apiKey">
            {(field) => (
              <FormField label="API key (optional)">
                <Input
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                  placeholder="Optional API key sent as x-api-key"
                  type="password"
                />
              </FormField>
            )}
          </form.Field>

          <DialogFooter>
            <Button type="button" onClick={() => setOpen(false)} size="sm" variant="ghost">
              Cancel
            </Button>
            <form.Subscribe selector={(state) => state.canSubmit}>
              {(canSubmit) => (
                <Button type="submit" disabled={!canSubmit} size="sm" variant="secondary">
                  Create
                </Button>
              )}
            </form.Subscribe>
          </DialogFooter>
        </form>
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
  onUpdate(input: McpSettingsUpdateInput): Promise<void>;
  onDelete(slug: string): Promise<void>;
}): React.ReactElement {
  const [displayName, setDisplayName] = useState(server.displayName);
  const [serverUrl, setServerUrl] = useState(server.serverUrl);
  const [apiKey, setApiKey] = useState("");
  const [clearApiKey, setClearApiKey] = useState(false);
  const [selectedTools, setSelectedTools] = useState<string[]>(server.selectedTools);
  const [tools, setTools] = useState<McpToolSummary[] | null>(null);
  const [toolError, setToolError] = useState<string | null>(null);
  const [isSaving, startSave] = useTransition();
  const toolsMutation = useListMcpTools();
  const isPending = isSaving || toolsMutation.isPending;
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
    toolsMutation.mutate(
      { slug: server.slug, serverUrl },
      {
        onSuccess: (next) => {
          setTools(next);
          if (selectedTools.length === 0) {
            setSelectedTools(next.map((tool) => tool.name));
          }
        },
        onError: (cause) => setToolError(messageOf(cause)),
      },
    );
  }

  function save(partial: { enabled?: boolean } = {}): void {
    startSave(async () => {
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
    startSave(async () => {
      await onDelete(server.slug);
    });
  }

  return (
    <div className="rounded-md border border-hairline bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium tracking-tight text-fg">{server.displayName}</p>
          <p className="mt-1 text-xs text-fg-dim">{server.message}</p>
          <p className="mt-1 font-mono text-2xs text-fg-mute">mcp.{server.slug}.*</p>
          {server.updatedAt ? (
            <p className="mt-1 font-mono text-2xs text-fg-mute">
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
          <label className="flex items-center gap-2 text-xs text-fg-dim">
            <input
              checked={clearApiKey}
              onChange={(event) => setClearApiKey(event.currentTarget.checked)}
              type="checkbox"
            />
            Clear saved API key on save
          </label>
        ) : null}
      </div>

      <div className="mt-4 rounded-md border border-hairline bg-surface-2 p-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-medium text-fg">Tools</p>
            <p className="mt-1 text-xs text-fg-dim">
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
            <p className="text-xs text-fg-mute">Refresh tools to populate this list.</p>
          ) : (
            knownToolNames.map((name) => {
              const summary = tools?.find((tool) => tool.name === name);
              return (
                <label key={name} className="flex items-start gap-2 text-xs text-fg-dim">
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
                    <span className="font-mono text-fg">{name}</span>
                    {summary?.description ? <span> — {summary.description}</span> : null}
                  </span>
                </label>
              );
            })
          )}
        </div>

        {toolError ? <p className="mt-3 text-xs text-bad">{toolError}</p> : null}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-xs text-fg-dim">
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
    <label className="grid gap-1.5 text-xs text-fg-dim">
      {label}
      <input
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
        placeholder={placeholder}
        type={type}
        className="h-9 rounded-md border border-hairline bg-bg px-3 font-mono text-xs text-fg outline-none focus:border-accent"
      />
    </label>
  );
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
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
