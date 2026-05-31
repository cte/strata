import { ArrowRight } from "lucide-react";
import type * as React from "react";
import { useState } from "react";
import { ConsoleBackdrop } from "@/components/shared/console-backdrop";
import { CtaButton } from "@/components/shared/cta-button";
import { Eyebrow } from "@/components/shared/eyebrow";
import { StrataMark } from "@/components/shared/strata-mark";
import { Input } from "@/components/ui/input";
import { useLogoutWeb, useUnlockWeb, useWebAuthStatus } from "@/lib/queries/auth";

export function WebAuthGate({ children }: { children: React.ReactNode }): React.ReactElement {
  const statusQuery = useWebAuthStatus();
  const unlock = useUnlockWeb();

  if (statusQuery.isPending) {
    return (
      <AuthShell
        status="pending"
        statusLabel="Verifying"
        title="Checking access"
        description="Verifying this browser session against the local web API."
      />
    );
  }

  if (statusQuery.isError) {
    return (
      <AuthShell
        status="error"
        statusLabel="Offline"
        title="Strata web unavailable"
        description={
          statusQuery.error instanceof Error
            ? statusQuery.error.message
            : "Could not reach the local web API."
        }
      />
    );
  }

  const status = statusQuery.data;
  if (!status.enabled || status.authenticated) {
    return <>{children}</>;
  }

  return <UnlockForm tokenSource={status.tokenSource} unlock={unlock} />;
}

export function WebAuthLogoutButton(): React.ReactElement | null {
  const statusQuery = useWebAuthStatus();
  const logout = useLogoutWeb();
  const status = statusQuery.data;
  if (status === undefined || !status.enabled || !status.authenticated) {
    return null;
  }
  return (
    <button
      type="button"
      onClick={() => logout.mutate()}
      disabled={logout.isPending}
      className="rounded border border-hairline px-2.5 py-1 text-xs font-medium text-fg-dim transition-[color,border-color,background-color] duration-150 hover:border-border hover:bg-surface-2 hover:text-fg disabled:cursor-not-allowed disabled:opacity-60"
    >
      {logout.isPending ? "Locking…" : "Lock"}
    </button>
  );
}

function UnlockForm({
  tokenSource,
  unlock,
}: {
  tokenSource: "env" | "local" | "disabled";
  unlock: ReturnType<typeof useUnlockWeb>;
}): React.ReactElement {
  const [token, setToken] = useState("");
  const trimmed = token.trim();
  const error = unlock.error instanceof Error ? unlock.error.message : null;

  return (
    <AuthShell
      status="locked"
      statusLabel="Locked"
      title="Unlock Strata"
      description="Enter the local web token to reach chat, connectors, routines, and the terminal."
    >
      <form
        className="mt-7 space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (trimmed === "") return;
          unlock.mutate(trimmed);
        }}
      >
        <label className="block space-y-2">
          <Eyebrow>Web token</Eyebrow>
          <div className="group relative">
            <span
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-mono text-sm text-fg-mute select-none transition-colors group-focus-within:text-accent"
            >
              ›
            </span>
            <Input
              type="password"
              autoFocus
              value={token}
              onChange={(event) => {
                if (unlock.error !== null) {
                  unlock.reset();
                }
                setToken(event.target.value);
              }}
              placeholder="Paste STRATA_WEB_TOKEN"
              className="pl-7 font-mono text-sm tracking-tight"
            />
          </div>
        </label>
        {error !== null ? (
          <p className="flex items-center gap-1.5 text-xs text-bad">
            <span aria-hidden="true" className="dot bg-bad" />
            {error}
          </p>
        ) : null}
        <CtaButton
          type="submit"
          icon={ArrowRight}
          disabled={trimmed === "" || unlock.isPending}
          className="mt-1 w-full"
        >
          {unlock.isPending ? "Unlocking…" : "Unlock console"}
        </CtaButton>
      </form>
      {tokenSource === "local" ? null : (
        <p className="mt-5 border-t border-hairline pt-4 text-xs leading-5 text-fg-mute">
          Set STRATA_WEB_TOKEN in the local .env to rotate this shared secret.
        </p>
      )}
    </AuthShell>
  );
}

type AuthStatus = "locked" | "pending" | "error";

const statusTone: Record<AuthStatus, { dot: string; text: string }> = {
  locked: { dot: "bg-accent", text: "text-accent" },
  pending: { dot: "bg-warn", text: "text-warn" },
  error: { dot: "bg-bad", text: "text-bad" },
};

function AuthShell({
  status,
  statusLabel,
  title,
  description,
  children,
}: {
  status: AuthStatus;
  statusLabel: string;
  title: string;
  description: string;
  children?: React.ReactNode;
}): React.ReactElement {
  const tone = statusTone[status];
  return (
    <main className="relative grid min-h-dvh place-items-center overflow-hidden bg-bg px-6 py-12 text-fg">
      <ConsoleBackdrop />
      <section className="relative z-10 w-full max-w-sm">
        <div className="mb-7 flex flex-col items-center text-center">
          <StrataMark className="h-24 w-24" />
          <Eyebrow className="mt-3">Strata · local console</Eyebrow>
        </div>
        <div className="rounded-md border border-hairline bg-bg-elev/70 p-7 shadow-2xl shadow-black/40 backdrop-blur-xl">
          <div
            className={`mb-4 inline-flex items-center gap-2 rounded-full border border-hairline bg-surface/60 px-2.5 py-1 font-mono text-2xs ${tone.text}`}
          >
            <span
              className={`dot ${tone.dot} ${status === "pending" ? "dot-pulse" : ""}`}
              aria-hidden="true"
            />
            <span className="uppercase tracking-[0.16em]">{statusLabel}</span>
          </div>
          <h1 className="text-md font-medium tracking-tight text-fg">{title}</h1>
          <p className="mt-2 text-sm leading-6 text-fg-dim">{description}</p>
          {children}
        </div>
      </section>
    </main>
  );
}
