import { Link } from "@tanstack/react-router";
import { Activity, CalendarClock, Pause, Play, RotateCw, Zap } from "lucide-react";
import type * as React from "react";
import { useEffect, useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  applyConnectorSchedulePreset,
  type ConnectorSchedulePreset,
  type ConnectorScheduleStatus,
  getConnectorScheduleStatus,
  runConnectorScheduleNow,
  type ScheduledConnectorName,
  setConnectorScheduleEnabled,
} from "@/lib/api";

export function ConnectorSchedulePanel({
  connector,
  title = "Recurring ingest",
}: {
  connector: ScheduledConnectorName;
  title?: string;
}): React.ReactElement {
  const [status, setStatus] = useState<ConnectorScheduleStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const refresh = () => {
    setError(null);
    getConnectorScheduleStatus(connector).then(setStatus, (cause: unknown) => {
      setError(cause instanceof Error ? cause.message : String(cause));
    });
  };

  useEffect(() => {
    let cancelled = false;
    setError(null);
    getConnectorScheduleStatus(connector).then(
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
  }, [connector]);

  const mutate = (operation: () => Promise<ConnectorScheduleStatus>) => {
    setError(null);
    startTransition(async () => {
      try {
        setStatus(await operation());
      } catch (cause: unknown) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    });
  };

  const schedule = status?.schedule ?? null;
  const busy = isPending || status === null;

  return (
    <section className="rounded-md border border-[var(--hairline)] bg-[var(--surface)]">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--hairline)] p-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <CalendarClock size={14} strokeWidth={1.75} className="text-[var(--fg-mute)]" />
            <h2 className="text-[13px] font-medium tracking-tight text-[var(--fg)]">{title}</h2>
          </div>
          <p className="mt-1 text-[12px] text-[var(--fg-dim)]">
            {schedule
              ? `${schedule.name} runs ${formatTrigger(schedule)}.`
              : "No connector schedule is configured."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {status ? <Badge tone="muted">{status.scheduleCount} schedules</Badge> : null}
          {schedule ? (
            <Badge tone={schedule.enabled ? "ready" : "muted"} pulse={schedule.enabled}>
              {schedule.enabled ? "enabled" : "disabled"}
            </Badge>
          ) : null}
          {schedule?.lastStatus ? (
            <Badge tone={schedule.lastStatus === "completed" ? "ready" : "bad"}>
              {schedule.lastStatus}
            </Badge>
          ) : null}
          {status?.scheduleProfile ? (
            <Badge tone="ready">profile</Badge>
          ) : status?.scheduleProfileMissing ? (
            <Badge tone="bad">missing profile</Badge>
          ) : null}
          <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={refresh}>
            <RotateCw size={13} strokeWidth={2} />
            Refresh
          </Button>
        </div>
      </div>

      <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(280px,0.9fr)]">
        <div className="space-y-4">
          {schedule ? (
            <div className="rounded-md border border-[var(--hairline)] bg-[var(--bg)] p-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[13px] font-medium text-[var(--fg)]">{schedule.name}</p>
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-[var(--fg-mute)]">
                    <span>{schedule.id}</span>
                    <span>{schedule.jobName}</span>
                    <span>{formatTrigger(schedule)}</span>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => mutate(() => runConnectorScheduleNow(connector))}
                  >
                    <Play size={13} strokeWidth={2} />
                    Run
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={busy}
                    onClick={() =>
                      mutate(() =>
                        setConnectorScheduleEnabled({
                          connector,
                          enabled: !schedule.enabled,
                        }),
                      )
                    }
                  >
                    <Pause size={13} strokeWidth={2} />
                    {schedule.enabled ? "Disable" : "Enable"}
                  </Button>
                </div>
              </div>
              <dl className="mt-3 grid gap-2 border-t border-[var(--hairline)] pt-3 text-[12px] sm:grid-cols-2">
                <Metric label="Next" value={formatTime(schedule.nextRunAt)} />
                <Metric label="Last" value={formatTime(schedule.lastRunAt)} />
                <Metric label="Session" value={schedule.lastSessionId ?? "none"} mono />
                <Metric
                  label="Profile"
                  value={
                    status?.scheduleProfile
                      ? status.scheduleProfile.label
                      : status?.scheduleProfileMissing
                        ? `missing ${status.scheduleProfileMissing}`
                        : "none"
                  }
                  mono={Boolean(status?.scheduleProfileMissing)}
                />
                <Metric label="Updated" value={formatTime(schedule.updatedAt)} />
              </dl>
              {schedule.lastError ? (
                <p className="mt-3 rounded-sm bg-[var(--bad)]/10 px-2 py-1.5 font-mono text-[11px] text-[var(--bad)]">
                  {schedule.lastError}
                </p>
              ) : null}
            </div>
          ) : (
            <div className="rounded-md border border-dashed border-[var(--hairline-strong)] bg-[var(--bg)] p-4 text-[13px] text-[var(--fg-dim)]">
              Choose a preset to create a durable local schedule for {connector}.
            </div>
          )}

          {status?.lastActivity ? (
            <div className="rounded-md border border-[var(--hairline)] bg-[var(--bg)] p-3">
              <div className="flex items-center gap-2">
                <Activity size={13} strokeWidth={1.75} className="text-[var(--fg-mute)]" />
                <p className="text-[12px] font-medium text-[var(--fg)]">Latest activity</p>
                <Badge tone={status.lastActivity.status === "completed" ? "ready" : "bad"}>
                  {status.lastActivity.status}
                </Badge>
              </div>
              <p className="mt-2 text-[13px] text-[var(--fg)]">{status.lastActivity.title}</p>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-[var(--fg-dim)]">
                <span>{formatTime(status.lastActivity.startedAt)}</span>
                <span>{status.lastActivity.operation}</span>
                <span>{activityCount(status.lastActivity.counts)}</span>
              </div>
              <Link
                to="/activity"
                className="mt-3 inline-flex font-mono text-[11px] text-[var(--accent)] hover:underline"
              >
                {status.lastActivity.sessionId}
              </Link>
            </div>
          ) : null}
        </div>

        <div className="space-y-2">
          <p className="label-eyebrow">presets</p>
          {status?.presets.map((preset) => (
            <button
              key={preset.id}
              type="button"
              disabled={busy}
              onClick={() =>
                mutate(() =>
                  applyConnectorSchedulePreset({
                    connector,
                    presetId: preset.id,
                    enabled: true,
                  }),
                )
              }
              className="group w-full rounded-md border border-[var(--hairline)] bg-[var(--bg)] p-3 text-left transition-colors duration-150 hover:border-[var(--hairline-strong)] hover:bg-[var(--surface-2)] disabled:pointer-events-none disabled:opacity-50"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="text-[13px] font-medium text-[var(--fg)]">{preset.label}</span>
                <Zap
                  size={13}
                  strokeWidth={2}
                  className="text-[var(--fg-mute)] transition-colors duration-150 group-hover:text-[var(--accent)]"
                />
              </div>
              <p className="mt-1 text-[12px] text-[var(--fg-dim)]">{preset.description}</p>
              <p className="mt-2 font-mono text-[11px] text-[var(--fg-mute)]">
                {formatTrigger({ trigger: preset.trigger })}
              </p>
              {preset.usesDefaultProfile && status?.defaultProfile ? (
                <p className="mt-1 truncate text-[11px] text-[var(--fg-mute)]">
                  tracks {status.defaultProfile.label}
                </p>
              ) : null}
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <div className="border-t border-[var(--hairline)] p-4">
          <p className="rounded-sm bg-[var(--bad)]/10 px-2 py-1.5 font-mono text-[11px] text-[var(--bad)]">
            {error}
          </p>
        </div>
      ) : null}
    </section>
  );
}

function Metric({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}): React.ReactElement {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-[var(--fg-mute)]">{label}</dt>
      <dd
        className={
          mono ? "truncate font-mono text-[11px] text-[var(--fg-dim)]" : "text-[var(--fg-dim)]"
        }
      >
        {value}
      </dd>
    </div>
  );
}

function formatTrigger(input: { trigger: ConnectorSchedulePreset["trigger"] }): string {
  if (input.trigger.type === "interval") {
    const seconds = input.trigger.seconds;
    if (seconds % 3600 === 0) {
      return `every ${seconds / 3600}h`;
    }
    if (seconds % 60 === 0) {
      return `every ${seconds / 60}m`;
    }
    return `every ${seconds}s`;
  }
  return input.trigger.expression;
}

function formatTime(value: string | null): string {
  if (!value) {
    return "never";
  }
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function activityCount(
  counts: NonNullable<ConnectorScheduleStatus["lastActivity"]>["counts"],
): string {
  if (counts.rawIndexed > 0) {
    return `${counts.rawIndexed} indexed`;
  }
  if (counts.rawWritten > 0) {
    return `${counts.rawWritten} written`;
  }
  if (counts.rawSkipped > 0) {
    return `${counts.rawSkipped} skipped`;
  }
  return `${counts.itemCount} events`;
}
