import type * as React from "react";
import { useState } from "react";
import { useLogoutWeb, useUnlockWeb, useWebAuthStatus } from "@/lib/queries/auth";

export function WebAuthGate({ children }: { children: React.ReactNode }): React.ReactElement {
  const statusQuery = useWebAuthStatus();
  const unlock = useUnlockWeb();

  if (statusQuery.isPending) {
    return <AuthShell title="Checking access…" description="Verifying this browser session." />;
  }

  if (statusQuery.isError) {
    return (
      <AuthShell
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
      title="Unlock Strata"
      description="Enter the local web token to access chat, connectors, routines, and the terminal."
    >
      <form
        className="mt-6 space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (trimmed === "") return;
          unlock.mutate(trimmed);
        }}
      >
        <label className="block space-y-2">
          <span className="text-xs font-medium uppercase tracking-[0.14em] text-fg-mute">
            Web token
          </span>
          <input
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
            className="h-11 w-full rounded-lg border border-hairline bg-surface px-3 font-mono text-sm text-fg outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-fg-mute focus:border-ring focus:ring-2 focus:ring-ring/30"
          />
        </label>
        {error !== null ? <p className="text-sm text-bad">{error}</p> : null}
        <button
          type="submit"
          disabled={trimmed === "" || unlock.isPending}
          className="h-10 w-full rounded-lg bg-accent px-4 text-sm font-semibold text-accent-fg transition-[opacity,transform] duration-150 hover:opacity-90 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50"
        >
          {unlock.isPending ? "Unlocking…" : "Unlock"}
        </button>
      </form>
      <p className="mt-4 text-xs leading-5 text-fg-mute">
        {tokenSource === "local"
          ? "No STRATA_WEB_TOKEN is set, so this instance generated a local token in .strata/web-auth-token. Read it from the VM terminal."
          : "Set STRATA_WEB_TOKEN in the local .env to rotate this shared secret."}
      </p>
    </AuthShell>
  );
}

function AuthShell({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: React.ReactNode;
}): React.ReactElement {
  return (
    <main className="grid min-h-dvh place-items-center bg-bg px-6 py-12 text-fg">
      <section className="w-full max-w-sm rounded-2xl border border-hairline bg-bg-elev p-7 shadow-2xl shadow-black/20">
        <div className="mb-5 flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-xl border border-hairline bg-surface-2 font-mono text-sm font-semibold text-accent">
            S
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-fg-mute">Strata web</p>
            <h1 className="text-xl font-semibold tracking-tight text-fg">{title}</h1>
          </div>
        </div>
        <p className="text-sm leading-6 text-fg-dim">{description}</p>
        {children}
      </section>
    </main>
  );
}
