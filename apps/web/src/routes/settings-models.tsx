import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, Cable, Unplug, X } from "lucide-react";
import type * as React from "react";
import { useEffect, useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  completeModelAuth,
  disconnectModelAuth,
  getModelAuthStatus,
  type ModelAuthProviderName,
  type ModelAuthProviderStatus,
  type ModelAuthStatus,
  startModelAuth,
} from "@/lib/api";

export function SettingsModelsPage(): React.ReactElement {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<ModelAuthStatus | null>(null);
  const [notice, setNotice] = useState<{ tone: "ready" | "bad"; message: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const callbackStatus = params.get("status");
    const message = params.get("message") ?? "";
    if (callbackStatus === "ok" || callbackStatus === "error") {
      setNotice({ tone: callbackStatus === "ok" ? "ready" : "bad", message });
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    getModelAuthStatus().then(
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

  async function handleManualComplete(
    provider: ModelAuthProviderName,
    authorizationResponse: string,
  ): Promise<void> {
    setError(null);
    try {
      setStatus(await completeModelAuth(provider, authorizationResponse));
      await queryClient.invalidateQueries({ queryKey: ["chat", "models"] });
      setNotice({ tone: "ready", message: "Model auth connected." });
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  function runProvider(provider: ModelAuthProviderName, action: "connect" | "disconnect"): void {
    setError(null);
    startTransition(async () => {
      try {
        if (action === "connect") {
          const next = await startModelAuth(provider, window.location.origin);
          window.location.assign(next.authorizationUrl);
          return;
        }
        setStatus(await disconnectModelAuth(provider));
        await queryClient.invalidateQueries({ queryKey: ["chat", "models"] });
      } catch (cause: unknown) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    });
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <BackLink />

      <header>
        <h1 className="text-[15px] font-medium tracking-tight text-[var(--fg)]">Model auth</h1>
        <p className="mt-1 text-[13px] text-[var(--fg-dim)]">
          Connect browser OAuth for model providers. Strata stores refresh credentials locally in
          <span className="font-mono text-[var(--fg)]"> .strata/auth.json</span>.
        </p>
      </header>

      {notice ? <CallbackNotice notice={notice} onDismiss={() => setNotice(null)} /> : null}

      <div className="space-y-3">
        {(status?.providers ?? fallbackProviders()).map((provider) => (
          <ProviderCard
            key={provider.provider}
            provider={provider}
            disabled={isPending || status === null}
            onConnect={() => runProvider(provider.provider, "connect")}
            onDisconnect={() => runProvider(provider.provider, "disconnect")}
            onManualComplete={(authorizationResponse) =>
              handleManualComplete(provider.provider, authorizationResponse)
            }
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

function ProviderCard({
  provider,
  disabled,
  onConnect,
  onDisconnect,
  onManualComplete,
}: {
  provider: ModelAuthProviderStatus;
  disabled: boolean;
  onConnect(): void;
  onDisconnect(): void;
  onManualComplete(authorizationResponse: string): Promise<void>;
}): React.ReactElement {
  const [manualOpen, setManualOpen] = useState(false);
  const [manualValue, setManualValue] = useState("");

  return (
    <div className="rounded-md border border-[var(--hairline)] bg-[var(--surface)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[13px] font-medium tracking-tight text-[var(--fg)]">
            {provider.displayName}
          </p>
          <p className="mt-1 text-[12px] text-[var(--fg-dim)]">{provider.message}</p>
          {provider.expiresAt ? (
            <p className="mt-1 font-mono text-[11px] text-[var(--fg-mute)]">
              token expires {new Date(provider.expiresAt).toISOString()}
            </p>
          ) : null}
        </div>
        <Badge tone={provider.authenticated ? "ready" : "muted"} pulse={provider.authenticated}>
          {provider.state.replace("_", " ")}
        </Badge>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button disabled={disabled} onClick={onConnect} variant="secondary" size="sm">
          <Cable size={13} strokeWidth={2} />
          {provider.authenticated ? "Reconnect" : "Connect"}
        </Button>
        <Button
          disabled={disabled || !provider.authenticated}
          onClick={onDisconnect}
          variant="secondary"
          size="sm"
        >
          <Unplug size={13} strokeWidth={2} />
          Disconnect
        </Button>
        <Button
          disabled={disabled}
          onClick={() => setManualOpen((open) => !open)}
          variant="ghost"
          size="sm"
        >
          Paste callback
        </Button>
      </div>

      {manualOpen ? (
        <form
          className="mt-3 space-y-2 rounded-md border border-[var(--hairline)] bg-[var(--surface-2)] p-3"
          onSubmit={(event) => {
            event.preventDefault();
            void onManualComplete(manualValue);
          }}
        >
          <p className="text-[12px] text-[var(--fg-dim)]">
            If Claude shows a code or lands on Anthropic's code callback page, paste the full
            callback URL or authorization code here.
          </p>
          <textarea
            value={manualValue}
            onChange={(event) => setManualValue(event.currentTarget.value)}
            className="min-h-20 w-full rounded-md border border-[var(--hairline)] bg-[var(--bg)] p-2 font-mono text-[12px] text-[var(--fg)] outline-none focus:border-[var(--accent)]"
            placeholder="https://platform.claude.com/oauth/code/callback?code=...&state=..."
          />
          <Button disabled={manualValue.trim() === ""} type="submit" variant="secondary" size="sm">
            Complete sign-in
          </Button>
        </form>
      ) : null}
    </div>
  );
}

function CallbackNotice({
  notice,
  onDismiss,
}: {
  notice: { tone: "ready" | "bad"; message: string };
  onDismiss: () => void;
}): React.ReactElement {
  const isReady = notice.tone === "ready";
  return (
    <div
      className={`flex items-start justify-between gap-3 rounded-md border p-3 ${
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

function fallbackProviders(): ModelAuthProviderStatus[] {
  return [
    {
      provider: "openai-codex",
      displayName: "OpenAI ChatGPT/Codex",
      authenticated: false,
      state: "not_connected",
      message: "Checking OpenAI ChatGPT/Codex auth...",
    },
    {
      provider: "anthropic-claude",
      displayName: "Anthropic Claude",
      authenticated: false,
      state: "not_connected",
      message: "Checking Anthropic Claude auth...",
    },
  ];
}
