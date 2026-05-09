import { Link } from "@tanstack/react-router";
import { ArrowLeft, Cable, Unplug } from "lucide-react";
import type * as React from "react";
import { useEffect, useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  configureGranola,
  disconnectGranola,
  type GranolaStatus,
  getGranolaStatus,
} from "@/lib/api";

export function ConnectorsGranolaPage(): React.ReactElement {
  const [status, setStatus] = useState<GranolaStatus | null>(null);
  const [apiToken, setApiToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    getGranolaStatus().then(
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

  function connect(): void {
    setError(null);
    startTransition(async () => {
      try {
        const next = await configureGranola({ apiToken: apiToken.trim() });
        setStatus(next);
        setApiToken("");
      } catch (cause: unknown) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    });
  }

  function disconnect(): void {
    setError(null);
    startTransition(async () => {
      try {
        const next = await disconnectGranola();
        setStatus(next);
        setApiToken("");
      } catch (cause: unknown) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    });
  }

  const connected = status?.state === "connected";
  const canSubmit = apiToken.trim() !== "" && !isPending;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <BackLink />

      <header>
        <h1 className="text-[15px] font-medium tracking-tight text-[var(--fg)]">Granola</h1>
        <p className="mt-1 text-[13px] text-[var(--fg-dim)]">
          Strata pulls meeting transcripts via Granola’s personal API into{" "}
          <span className="font-mono text-[var(--fg)]">wiki/raw/granola/</span>. Your key is stored
          locally at{" "}
          <span className="font-mono text-[var(--fg)]">.strata/secrets/granola.json</span>.
        </p>
      </header>

      <div className="rounded-md border border-[var(--hairline)] bg-[var(--surface)] p-4">
        <div className="flex items-start justify-between gap-3 border-b border-[var(--hairline)] pb-3">
          <div>
            <p className="text-[13px] font-medium tracking-tight text-[var(--fg)]">
              Personal API key
            </p>
            {status ? (
              <p className="mt-1 text-[12px] text-[var(--fg-dim)]">{status.message}</p>
            ) : null}
          </div>
          <Badge tone={connected ? "ready" : "muted"} pulse={connected}>
            {(status?.state ?? "unknown").replace("_", " ")}
          </Badge>
        </div>

        <form
          className="mt-4 space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (canSubmit) {
              connect();
            }
          }}
        >
          <label className="block space-y-1.5">
            <span className="text-[12px] text-[var(--fg-dim)]">API key</span>
            <Input
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={apiToken}
              onChange={(event) => setApiToken(event.target.value)}
              placeholder={connected ? "•••••• stored locally" : "grn_…"}
            />
            <span className="block text-[11px] text-[var(--fg-mute)]">
              Strata sends a single GET to{" "}
              <span className="font-mono text-[var(--fg-dim)]">public-api.granola.ai/v1/notes</span>{" "}
              to validate.
            </span>
          </label>

          <div className="flex flex-wrap gap-2 pt-1">
            <Button type="submit" disabled={!canSubmit} size="sm">
              <Cable size={13} strokeWidth={2} />
              {connected ? "Replace key" : "Validate & save"}
            </Button>
            {connected ? (
              <Button
                type="button"
                disabled={isPending}
                onClick={disconnect}
                variant="secondary"
                size="sm"
              >
                <Unplug size={13} strokeWidth={2} />
                Disconnect
              </Button>
            ) : null}
          </div>
        </form>

        {status?.validatedAt ? (
          <p className="mt-4 border-t border-[var(--hairline)] pt-3 text-[11px] text-[var(--fg-mute)]">
            last validated{" "}
            <span className="font-mono text-[var(--fg-dim)]">
              {new Date(status.validatedAt).toISOString().replace("T", " ").slice(0, 19)} UTC
            </span>
          </p>
        ) : null}
      </div>

      {error ? (
        <div className="rounded-md border border-[var(--bad)]/40 bg-[var(--bad)]/[0.06] p-3">
          <p className="font-mono text-[12px] text-[var(--bad)]">Validation failed</p>
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
