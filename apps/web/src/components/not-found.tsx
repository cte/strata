import { useNavigate, useRouter } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight } from "lucide-react";
import type * as React from "react";
import { ConsoleBackdrop } from "@/components/shared/console-backdrop";
import { CtaButton } from "@/components/shared/cta-button";
import { Eyebrow } from "@/components/shared/eyebrow";
import { StrataMark } from "@/components/shared/strata-mark";
import { Button } from "@/components/ui/button";

/**
 * "Lost stratum" 404 — shares the lock screen's console backdrop and
 * stacked-layers mark so unknown routes still feel like part of the system.
 * Renders inside RootLayout (sidebar + rail stay available) as a contained
 * console panel. Wired as the router's defaultNotFoundComponent.
 */
export function NotFound(): React.ReactElement {
  const router = useRouter();
  const navigate = useNavigate();
  const path = typeof window !== "undefined" ? window.location.pathname : "";

  return (
    <section className="relative grid min-h-[calc(100dvh-9rem)] place-items-center overflow-hidden rounded-md border border-hairline bg-bg-elev/40 px-6 py-12">
      <ConsoleBackdrop />
      <div className="relative z-10 flex w-full max-w-md flex-col items-center text-center">
        <div className="relative">
          <StrataMark className="h-28 w-28" />
          <span className="absolute -right-2 -top-1 rounded-full border border-bad/40 bg-bad/[0.08] px-2 py-0.5 font-mono text-2xs font-semibold text-bad">
            404
          </span>
        </div>

        <Eyebrow className="mt-4">Stratum not found</Eyebrow>
        <h1 className="mt-2 text-md font-medium tracking-tight text-fg">
          This layer doesn&rsquo;t exist
        </h1>
        <p className="mt-2 max-w-sm text-sm leading-6 text-fg-dim">
          The route you followed isn&rsquo;t part of the console. It may have been moved, renamed,
          or never mapped.
        </p>

        {path ? (
          <code className="mt-4 max-w-full truncate rounded-md border border-hairline bg-surface/60 px-3 py-1.5 font-mono text-xs text-fg-mute">
            {path}
          </code>
        ) : null}

        <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
          <CtaButton icon={ArrowRight} onClick={() => navigate({ to: "/chat" })}>
            Back to chat
          </CtaButton>
          <Button variant="outline" size="lg" onClick={() => router.history.back()}>
            <ArrowLeft />
            Go back
          </Button>
        </div>
      </div>
    </section>
  );
}
