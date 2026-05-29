import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Cable, LoaderCircle, Unplug } from "lucide-react";
import type * as React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  clearModelApiKey,
  completeModelAuth,
  disconnectModelAuth,
  getModelAuthStatus,
  type ModelApiKeyStatus,
  type ModelApiKeyTarget,
  type ModelAuthProviderName,
  type ModelAuthProviderStatus,
  setModelApiKey,
  startModelAuth,
} from "@/lib/api";

const AUTH_STATUS_KEY = ["model-auth", "status"] as const;
/** Poll while open so a popup OAuth completion (Codex loopback) is detected. */
const POLL_INTERVAL_MS = 1_500;

type AuthMethod = "oauth" | "apiKey";

/** One provider, with its OAuth provider id and its mutually-exclusive API-key target. */
interface ProviderGroup {
  name: string;
  oauth: ModelAuthProviderName;
  apiKey: ModelApiKeyTarget;
}

const PROVIDER_GROUPS: ProviderGroup[] = [
  { name: "OpenAI", oauth: "openai-codex", apiKey: "openai" },
  { name: "Anthropic", oauth: "anthropic-claude", apiKey: "anthropic" },
];

/** Anthropic's callback shows a code on its own page that must be pasted back. */
function isManualProvider(provider: ModelAuthProviderName): boolean {
  return provider === "anthropic-claude";
}

export function ModelAuthDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
}): React.ReactElement {
  const queryClient = useQueryClient();
  const statusQuery = useQuery({
    queryKey: AUTH_STATUS_KEY,
    queryFn: getModelAuthStatus,
    enabled: open,
    refetchInterval: open ? POLL_INTERVAL_MS : false,
  });
  const providers = statusQuery.data?.providers;
  const apiKeys = statusQuery.data?.apiKeys;

  // When connected credentials change (e.g. a popup OAuth finished, or a key was
  // saved/cleared), refresh the model picker's lists/status so models update.
  const authedRef = useRef<string>("");
  useEffect(() => {
    if (providers === undefined || apiKeys === undefined) {
      return;
    }
    const signature = [
      ...providers.filter((p) => p.authenticated).map((p) => `oauth:${p.provider}`),
      ...apiKeys.filter((k) => k.configured).map((k) => `key:${k.target}`),
    ]
      .sort()
      .join(",");
    if (signature !== authedRef.current) {
      authedRef.current = signature;
      void queryClient.invalidateQueries({ queryKey: ["chat", "models"] });
    }
  }, [providers, apiKeys, queryClient]);

  const refresh = useCallback(() => {
    void statusQuery.refetch();
    void queryClient.invalidateQueries({ queryKey: ["chat", "models"] });
  }, [queryClient, statusQuery]);

  const loaded = providers !== undefined && apiKeys !== undefined;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg border-[var(--hairline-strong)] bg-[var(--bg-elev)] text-[var(--fg)]">
        <DialogHeader>
          <DialogTitle className="text-[14px]">Model providers</DialogTitle>
          <DialogDescription className="text-[12px] text-[var(--fg-dim)]">
            Connect each provider with OAuth or an API key — the two are mutually exclusive.
            Credentials are stored locally in{" "}
            <span className="font-mono text-[var(--fg)]">.strata/auth.json</span>.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {loaded ? (
            PROVIDER_GROUPS.map((group) => {
              const provider = providers.find((p) => p.provider === group.oauth);
              const apiKey = apiKeys.find((k) => k.target === group.apiKey);
              if (provider === undefined || apiKey === undefined) {
                return null;
              }
              return (
                <ProviderCard
                  key={group.name}
                  name={group.name}
                  provider={provider}
                  apiKey={apiKey}
                  onChanged={refresh}
                />
              );
            })
          ) : (
            <div className="flex items-center gap-2 px-1 py-3 text-[12px] text-[var(--fg-mute)]">
              <LoaderCircle size={13} strokeWidth={1.75} className="animate-spin" />
              Loading providers…
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ProviderCard({
  name,
  provider,
  apiKey,
  onChanged,
}: {
  name: string;
  provider: ModelAuthProviderStatus;
  apiKey: ModelApiKeyStatus;
  onChanged(): void;
}): React.ReactElement {
  // The active credential, if any, drives the badge and the default toggle.
  const activeMethod: AuthMethod | null = apiKey.configured
    ? "apiKey"
    : provider.authenticated
      ? "oauth"
      : null;
  const [method, setMethod] = useState<AuthMethod>(activeMethod ?? "oauth");

  // Snap the toggle to whatever method just became active (e.g. after connect/save).
  const activeRef = useRef<AuthMethod | null>(activeMethod);
  useEffect(() => {
    if (activeMethod !== null && activeMethod !== activeRef.current) {
      setMethod(activeMethod);
    }
    activeRef.current = activeMethod;
  }, [activeMethod]);

  const badge =
    activeMethod === "apiKey"
      ? { tone: "ready" as const, label: "API key" }
      : activeMethod === "oauth"
        ? { tone: "ready" as const, label: "OAuth" }
        : { tone: "muted" as const, label: "not connected" };

  return (
    <div className="rounded-md border border-[var(--hairline)] bg-[var(--surface)] p-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[13px] font-medium tracking-tight text-[var(--fg)]">{name}</p>
        <Badge tone={badge.tone} pulse={badge.tone === "ready"}>
          {badge.label}
        </Badge>
      </div>

      <div className="mt-2.5 inline-flex rounded-md border border-[var(--hairline)] bg-[var(--surface-2)] p-0.5">
        <MethodTab
          active={method === "oauth"}
          configured={activeMethod === "oauth"}
          onClick={() => setMethod("oauth")}
        >
          OAuth
        </MethodTab>
        <MethodTab
          active={method === "apiKey"}
          configured={activeMethod === "apiKey"}
          onClick={() => setMethod("apiKey")}
        >
          API key
        </MethodTab>
      </div>

      <div className="mt-3">
        {method === "oauth" ? (
          <OAuthPanel provider={provider} onChanged={onChanged} />
        ) : (
          <ApiKeyPanel apiKey={apiKey} onChanged={onChanged} />
        )}
      </div>
    </div>
  );
}

function MethodTab({
  active,
  configured,
  onClick,
  children,
}: {
  active: boolean;
  configured: boolean;
  onClick(): void;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-[11.5px] font-medium transition-colors ${
        active
          ? "bg-[var(--bg-elev)] text-[var(--fg)] shadow-sm"
          : "text-[var(--fg-mute)] hover:text-[var(--fg-dim)]"
      }`}
    >
      {children}
      {configured ? (
        <span
          className="size-1.5 rounded-full bg-[var(--good,var(--accent))]"
          aria-label="active"
        />
      ) : null}
    </button>
  );
}

function OAuthPanel({
  provider,
  onChanged,
}: {
  provider: ModelAuthProviderStatus;
  onChanged(): void;
}): React.ReactElement {
  const [busy, setBusy] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteValue, setPasteValue] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Stop showing "waiting…" once the provider reports authenticated.
  useEffect(() => {
    if (provider.authenticated) {
      setPending(false);
    }
  }, [provider.authenticated]);

  const connect = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      const result = await startModelAuth(provider.provider, window.location.origin);
      window.open(result.authorizationUrl, "_blank", "noopener,noreferrer");
      setPending(true);
      if (isManualProvider(provider.provider)) {
        setPasteOpen(true);
      }
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, [provider.provider]);

  const disconnect = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      await disconnectModelAuth(provider.provider);
      setPending(false);
      setPasteOpen(false);
      onChanged();
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, [onChanged, provider.provider]);

  const complete = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      await completeModelAuth(provider.provider, pasteValue);
      setPasteValue("");
      setPasteOpen(false);
      setPending(false);
      onChanged();
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, [onChanged, pasteValue, provider.provider]);

  return (
    <div>
      <p className="text-[12px] text-[var(--fg-dim)]">
        {pending && !provider.authenticated ? "Waiting for authorization…" : provider.message}
      </p>
      {provider.expiresAt ? (
        <p className="mt-0.5 font-mono text-[10.5px] text-[var(--fg-mute)]">
          expires {new Date(provider.expiresAt).toISOString()}
        </p>
      ) : null}

      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <Button disabled={busy} onClick={() => void connect()} variant="secondary" size="sm">
          {busy ? (
            <LoaderCircle size={13} strokeWidth={2} className="animate-spin" />
          ) : (
            <Cable size={13} strokeWidth={2} />
          )}
          {provider.authenticated ? "Reconnect" : "Connect"}
        </Button>
        {provider.authenticated ? (
          <Button disabled={busy} onClick={() => void disconnect()} variant="ghost" size="sm">
            <Unplug size={13} strokeWidth={2} />
            Disconnect
          </Button>
        ) : null}
        {isManualProvider(provider.provider) && !provider.authenticated ? (
          <Button
            disabled={busy}
            onClick={() => setPasteOpen((value) => !value)}
            variant="ghost"
            size="sm"
          >
            Paste code
          </Button>
        ) : null}
      </div>

      {pasteOpen ? (
        <form
          className="mt-2.5 space-y-2 rounded-md border border-[var(--hairline)] bg-[var(--surface-2)] p-2.5"
          onSubmit={(event) => {
            event.preventDefault();
            void complete();
          }}
        >
          <p className="text-[11.5px] text-[var(--fg-dim)]">
            After authorizing, paste the full callback URL or authorization code here.
          </p>
          <textarea
            value={pasteValue}
            onChange={(event) => setPasteValue(event.currentTarget.value)}
            className="min-h-16 w-full rounded-md border border-[var(--hairline)] bg-[var(--bg)] p-2 font-mono text-[11.5px] text-[var(--fg)] outline-none focus:border-[var(--accent)]"
            placeholder="https://…/callback?code=…&state=…"
          />
          <Button
            disabled={busy || pasteValue.trim() === ""}
            type="submit"
            variant="secondary"
            size="sm"
          >
            Complete sign-in
          </Button>
        </form>
      ) : null}

      {error ? <p className="mt-2 font-mono text-[11px] text-[var(--bad)]">{error}</p> : null}
    </div>
  );
}

function ApiKeyPanel({
  apiKey,
  onChanged,
}: {
  apiKey: ModelApiKeyStatus;
  onChanged(): void;
}): React.ReactElement {
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [baseUrl, setBaseUrl] = useState(apiKey.baseUrl ?? "");
  const [error, setError] = useState<string | null>(null);

  const save = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      await setModelApiKey({
        target: apiKey.target,
        apiKey: value,
        ...(apiKey.supportsBaseUrl && baseUrl.trim() !== "" ? { baseUrl: baseUrl.trim() } : {}),
      });
      setValue("");
      setEditing(false);
      onChanged();
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, [apiKey.supportsBaseUrl, apiKey.target, baseUrl, onChanged, value]);

  const clear = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      await clearModelApiKey(apiKey.target);
      setValue("");
      setBaseUrl("");
      setEditing(false);
      onChanged();
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, [apiKey.target, onChanged]);

  const showForm = editing || !apiKey.configured;

  return (
    <div>
      <p className="font-mono text-[11.5px] text-[var(--fg-dim)]">
        {apiKey.configured ? `key ${apiKey.hint}` : "not set"}
        {apiKey.configured && apiKey.baseUrl ? ` · ${apiKey.baseUrl}` : ""}
      </p>

      {showForm ? (
        <form
          className="mt-2.5 space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <input
            type="password"
            value={value}
            onChange={(event) => setValue(event.currentTarget.value)}
            autoComplete="off"
            spellCheck={false}
            className="w-full rounded-md border border-[var(--hairline)] bg-[var(--bg)] p-2 font-mono text-[11.5px] text-[var(--fg)] outline-none focus:border-[var(--accent)]"
            placeholder={apiKey.target === "openai" ? "sk-…" : "sk-ant-…"}
          />
          {apiKey.supportsBaseUrl ? (
            <input
              type="text"
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.currentTarget.value)}
              autoComplete="off"
              spellCheck={false}
              className="w-full rounded-md border border-[var(--hairline)] bg-[var(--bg)] p-2 font-mono text-[11.5px] text-[var(--fg)] outline-none focus:border-[var(--accent)]"
              placeholder="Base URL (optional, e.g. https://api.openai.com/v1)"
            />
          ) : null}
          <div className="flex items-center gap-2">
            <Button
              disabled={busy || value.trim() === ""}
              type="submit"
              variant="secondary"
              size="sm"
            >
              Save key
            </Button>
            {editing ? (
              <Button
                disabled={busy}
                onClick={() => {
                  setEditing(false);
                  setValue("");
                }}
                variant="ghost"
                size="sm"
              >
                Cancel
              </Button>
            ) : null}
          </div>
        </form>
      ) : (
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <Button disabled={busy} onClick={() => setEditing(true)} variant="secondary" size="sm">
            Replace key
          </Button>
          <Button disabled={busy} onClick={() => void clear()} variant="ghost" size="sm">
            <Unplug size={13} strokeWidth={2} />
            Clear
          </Button>
        </div>
      )}

      {error ? <p className="mt-2 font-mono text-[11px] text-[var(--bad)]">{error}</p> : null}
    </div>
  );
}
