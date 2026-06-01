import { REGEXP_ONLY_DIGITS } from "input-otp";
import { Check, Lock, LockOpen } from "lucide-react";
import type * as React from "react";
import { useState } from "react";
import { ConsoleBackdrop } from "@/components/shared/console-backdrop";
import { CtaButton } from "@/components/shared/cta-button";
import { Eyebrow } from "@/components/shared/eyebrow";
import { StrataMark } from "@/components/shared/strata-mark";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { useLogoutWeb, useUnlockWeb, useWebAuthStatus } from "@/lib/queries/auth";

export function WebAuthGate({ children }: { children: React.ReactNode }): React.ReactElement {
  const statusQuery = useWebAuthStatus();

  if (statusQuery.isPending) {
    return <AuthLoadingShell />;
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

  return <UnlockForm />;
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
      aria-label="Lock Strata"
      title="Lock Strata"
      className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-hairline bg-bg-elev text-fg-mute transition-colors duration-150 hover:border-hairline-strong hover:text-fg-dim focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:cursor-not-allowed disabled:opacity-60"
    >
      <Lock size={12} strokeWidth={1.75} aria-hidden="true" />
    </button>
  );
}

const PASSCODE_LENGTH = 4;

function UnlockForm(): React.ReactElement {
  const unlock = useUnlockWeb();
  const [passcode, setPasscode] = useState("");
  const complete = passcode.length === PASSCODE_LENGTH;
  const rejected = unlock.isError;
  const unlocked = unlock.isSuccess;
  const LockGlyph = unlocked ? LockOpen : Lock;

  return (
    <AuthShell status="locked">
      <div className="mt-1 mb-6 flex justify-center">
        <div
          className={`flex h-16 w-16 items-center justify-center rounded-full border transition-colors duration-500 ${
            unlocked ? "border-good/30 bg-good/10" : "border-bad/30 bg-bad/10"
          }`}
        >
          <LockGlyph
            aria-hidden="true"
            strokeWidth={1.5}
            className={`h-7 w-7 transition-colors duration-500 ${
              unlocked ? "text-good" : "text-bad"
            }`}
          />
        </div>
      </div>
      <form
        className="mt-7 space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (!complete) return;
          unlock.mutate(passcode);
        }}
      >
        <div className={`flex justify-center ${rejected ? "animate-pulse" : ""}`}>
          <InputOTP
            maxLength={PASSCODE_LENGTH}
            pattern={REGEXP_ONLY_DIGITS}
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            disabled={unlock.isPending || unlocked}
            value={passcode}
            onChange={(value) => {
              if (unlock.error !== null) {
                unlock.reset();
              }
              setPasscode(value);
            }}
          >
            <InputOTPGroup className="gap-2">
              {Array.from({ length: PASSCODE_LENGTH }, (_, index) => (
                <InputOTPSlot
                  // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length passcode slots
                  key={index}
                  index={index}
                  mask
                  className={`h-12 w-12 rounded-md border-l text-md ${
                    rejected ? "border-bad/60" : ""
                  }`}
                />
              ))}
            </InputOTPGroup>
          </InputOTP>
        </div>
        <CtaButton
          type="submit"
          {...(unlocked ? { icon: Check } : {})}
          disabled={!complete || unlock.isPending || unlocked}
          className="mt-1 w-full"
        >
          {unlocked ? "Unlocked" : unlock.isPending ? "Unlocking…" : "Unlock"}
        </CtaButton>
      </form>
    </AuthShell>
  );
}

type AuthStatus = "locked" | "error";

const statusTone: Record<AuthStatus, { dot: string; text: string }> = {
  locked: { dot: "bg-accent", text: "text-accent" },
  error: { dot: "bg-bad", text: "text-bad" },
};

function AuthLoadingShell(): React.ReactElement {
  return (
    <main className="grid min-h-dvh place-items-center bg-bg" aria-busy="true">
      <span className="dot dot-pulse bg-fg-mute" aria-label="Loading" />
    </main>
  );
}

function AuthShell({
  status,
  statusLabel,
  title,
  description,
  children,
}: {
  status: AuthStatus;
  statusLabel?: string;
  title?: string;
  description?: string;
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
          {statusLabel !== undefined ? (
            <div
              className={`mb-4 inline-flex items-center gap-2 rounded-full border border-hairline bg-surface/60 px-2.5 py-1 font-mono text-2xs ${tone.text}`}
            >
              <span className={`dot ${tone.dot}`} aria-hidden="true" />
              <span className="uppercase tracking-[0.16em]">{statusLabel}</span>
            </div>
          ) : null}
          {title !== undefined ? (
            <h1 className="text-md font-medium tracking-tight text-fg">{title}</h1>
          ) : null}
          {description !== undefined ? (
            <p className="mt-2 text-sm leading-6 text-fg-dim">{description}</p>
          ) : null}
          {children}
        </div>
      </section>
    </main>
  );
}
