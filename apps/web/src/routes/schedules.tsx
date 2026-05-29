import {
  Activity,
  BookOpenCheck,
  Bot,
  CalendarClock,
  ChevronDown,
  Database,
  FileSearch,
  Pause,
  Play,
  Plus,
  RotateCw,
  Settings2,
  Trash2,
} from "lucide-react";
import type * as React from "react";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { PageContainer, PageHeader } from "@/components/page-layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  applyConnectorSchedulePreset,
  type ConnectorScheduleStatus,
  createSchedule,
  deleteSchedule,
  getConnectorScheduleStatus,
  type JobSchedule,
  listSchedules,
  runConnectorScheduleNow,
  runScheduleNow,
  type ScheduledConnectorName,
  setConnectorScheduleEnabled,
  updateSchedule,
} from "@/lib/api";
import { cn } from "@/lib/utils";

type ScheduleCategory = "source" | "wiki" | "agent" | "advanced";
type AgentPromptToolProfile = "read-only" | "maintenance" | "dangerous";

interface ConnectorScheduleView {
  connector: ScheduledConnectorName;
  title: string;
  description: string;
}

interface WikiAutomationPreset {
  id: string;
  title: string;
  description: string;
  jobName: string;
  cadences: WikiAutomationCadence[];
}

interface WikiAutomationCadence {
  id: string;
  label: string;
  description: string;
  scheduleName: string;
  trigger: JobSchedule["trigger"];
  input: Record<string, unknown>;
}

interface CadenceOption {
  id: string;
  label: string;
  description: string;
  scheduleName?: string;
  trigger: JobSchedule["trigger"];
}

interface AgentPromptCadence {
  id: string;
  label: string;
  description: string;
  scheduleName: string;
  trigger: JobSchedule["trigger"];
}

const CONNECTOR_SCHEDULES: ConnectorScheduleView[] = [
  {
    connector: "granola",
    title: "Granola notes",
    description: "Capture recent meeting notes, organize them into the wiki, and refresh search.",
  },
  {
    connector: "slack",
    title: "Slack conversations",
    description:
      "Checkpoint channel history, save material threads, and surface durable follow-ups.",
  },
];

const WIKI_AUTOMATION_PRESETS: WikiAutomationPreset[] = [
  {
    id: "wiki-hygiene-daily",
    title: "Wiki hygiene",
    description:
      "Looks for duplicate project pages, stages consolidation proposals, and refreshes retrieval.",
    jobName: "wiki.hygiene",
    cadences: [
      {
        id: "daily",
        label: "Daily",
        description: "Runs the safe hygiene audit once per day.",
        scheduleName: "Daily wiki hygiene",
        trigger: { type: "interval", seconds: 86_400 },
        input: { refreshSearchIndex: true, includeRaw: true },
      },
      {
        id: "weekly",
        label: "Weekly",
        description: "Runs a lower-noise hygiene audit once per week.",
        scheduleName: "Weekly wiki hygiene",
        trigger: { type: "interval", seconds: 604_800 },
        input: { refreshSearchIndex: true, includeRaw: true },
      },
    ],
  },
  {
    id: "search-index-hourly",
    title: "Search refresh",
    description:
      "Rebuilds the curated-first retrieval index used by wiki search and agent context.",
    jobName: "wiki.search-index.refresh",
    cadences: [
      {
        id: "hourly",
        label: "Hourly",
        description: "Keeps retrieval fresh for recent source and wiki changes.",
        scheduleName: "Hourly search refresh",
        trigger: { type: "interval", seconds: 3_600 },
        input: { source: "all", includeRaw: true },
      },
      {
        id: "daily",
        label: "Daily",
        description: "Refreshes retrieval once per day for quieter local operation.",
        scheduleName: "Daily search refresh",
        trigger: { type: "interval", seconds: 86_400 },
        input: { source: "all", includeRaw: true },
      },
    ],
  },
];

const AGENT_PROMPT_CADENCES: AgentPromptCadence[] = [
  {
    id: "hourly",
    label: "Hourly",
    description: "Runs the prompt once per hour.",
    scheduleName: "Hourly agent prompt",
    trigger: { type: "interval", seconds: 3_600 },
  },
  {
    id: "daily",
    label: "Daily",
    description: "Runs the prompt once per day.",
    scheduleName: "Daily agent prompt",
    trigger: { type: "interval", seconds: 86_400 },
  },
  {
    id: "weekly",
    label: "Weekly",
    description: "Runs the prompt once per week.",
    scheduleName: "Weekly agent prompt",
    trigger: { type: "interval", seconds: 604_800 },
  },
];

const AGENT_TOOL_PROFILE_OPTIONS: {
  value: AgentPromptToolProfile;
  label: string;
  description: string;
}[] = [
  {
    value: "maintenance",
    label: "Workspace maintenance",
    description: "Read and write local wiki/workspace files; shell is unavailable.",
  },
  {
    value: "read-only",
    label: "Read only",
    description: "Inspect wiki, files, sessions, memory, todos, and skills without writing.",
  },
  {
    value: "dangerous",
    label: "Full access",
    description: "Allows writes, learning tools, and shell commands.",
  },
];

export function SchedulesPage(): React.ReactElement {
  const [schedules, setSchedules] = useState<JobSchedule[]>([]);
  const [connectorStatuses, setConnectorStatuses] = useState<
    Partial<Record<ScheduledConnectorName, ConnectorScheduleStatus>>
  >({});
  const [connectorErrors, setConnectorErrors] = useState<
    Partial<Record<ScheduledConnectorName, string>>
  >({});
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [agentName, setAgentName] = useState("Daily agent session");
  const [agentPrompt, setAgentPrompt] = useState("");
  const [agentCadenceId, setAgentCadenceId] = useState("daily");
  const [agentToolProfile, setAgentToolProfile] = useState<AgentPromptToolProfile>("maintenance");
  const [isPending, startTransition] = useTransition();

  const refreshData = useCallback(async () => {
    setError(null);
    const connectorResultsPromise = Promise.all(
      CONNECTOR_SCHEDULES.map(async ({ connector }) => {
        try {
          return { connector, status: await getConnectorScheduleStatus(connector), error: null };
        } catch (cause: unknown) {
          return {
            connector,
            status: null,
            error: cause instanceof Error ? cause.message : String(cause),
          };
        }
      }),
    );
    const [connectorResults, nextSchedules] = await Promise.all([
      connectorResultsPromise,
      listSchedules(),
    ]);
    const nextStatuses: Partial<Record<ScheduledConnectorName, ConnectorScheduleStatus>> = {};
    const nextErrors: Partial<Record<ScheduledConnectorName, string>> = {};
    for (const result of connectorResults) {
      if (result.status === null) {
        nextErrors[result.connector] = result.error ?? "Could not load schedule status.";
      } else {
        nextStatuses[result.connector] = result.status;
      }
    }
    setSchedules(nextSchedules);
    setConnectorStatuses(nextStatuses);
    setConnectorErrors(nextErrors);
    setLoaded(true);
  }, []);

  useEffect(() => {
    refreshData().catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : String(cause));
      setLoaded(true);
    });
  }, [refreshData]);

  const mutate = useCallback(
    (key: string, operation: () => Promise<unknown>) => {
      setBusyKey(key);
      setError(null);
      startTransition(async () => {
        try {
          await operation();
          await refreshData();
        } catch (cause: unknown) {
          setError(cause instanceof Error ? cause.message : String(cause));
        } finally {
          setBusyKey(null);
        }
      });
    },
    [refreshData],
  );

  const stats = useMemo(() => scheduleStats(schedules), [schedules]);
  const grouped = useMemo(() => groupSchedules(schedules), [schedules]);
  const busy = isPending || busyKey !== null;
  const selectedAgentCadence = agentPromptCadence(agentCadenceId);

  return (
    <PageContainer width="wide">
      <PageHeader
        icon={<CalendarClock size={15} strokeWidth={1.75} />}
        title="Schedules"
        description="Local automations for source capture, wiki upkeep, and scheduled agent sessions."
        actions={
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => {
              startTransition(async () => {
                try {
                  await refreshData();
                } catch (cause: unknown) {
                  setError(cause instanceof Error ? cause.message : String(cause));
                }
              });
            }}
            disabled={busy}
          >
            <RotateCw size={13} strokeWidth={2} className={cn(isPending && "animate-spin")} />
            Refresh
          </Button>
        }
      />

      <ScheduleStats stats={stats} />

      {error ? <ErrorCallout label="schedules error" message={error} /> : null}

      <section className="space-y-3">
        <SectionTitle
          icon={<Database size={14} strokeWidth={1.75} />}
          title="Source Syncs"
          count={CONNECTOR_SCHEDULES.length}
        />
        <div className="grid gap-3 lg:grid-cols-2">
          {CONNECTOR_SCHEDULES.map((config) => {
            const status = connectorStatuses[config.connector] ?? null;
            return (
              <ConnectorAutomationCard
                key={config.connector}
                config={config}
                status={status}
                error={connectorErrors[config.connector] ?? null}
                disabled={!loaded || busy}
                busyKey={busyKey}
                onApplyPreset={(presetId) =>
                  mutate(`${config.connector}:${presetId}`, () =>
                    applyConnectorSchedulePreset({
                      connector: config.connector,
                      presetId,
                      enabled: status?.schedule?.enabled ?? true,
                    }),
                  )
                }
                onRun={() =>
                  mutate(`${config.connector}:run`, () => runConnectorScheduleNow(config.connector))
                }
                onToggle={(enabled) =>
                  mutate(`${config.connector}:toggle`, () =>
                    setConnectorScheduleEnabled({ connector: config.connector, enabled }),
                  )
                }
              />
            );
          })}
        </div>
      </section>

      <section className="space-y-3">
        <SectionTitle
          icon={<BookOpenCheck size={14} strokeWidth={1.75} />}
          title="Wiki Upkeep"
          count={WIKI_AUTOMATION_PRESETS.length}
        />
        <div className="grid gap-3 lg:grid-cols-2">
          {WIKI_AUTOMATION_PRESETS.map((preset) => {
            const existing = findPresetSchedule(schedules, preset);
            return (
              <WikiAutomationCard
                key={preset.id}
                preset={preset}
                schedule={existing}
                disabled={!loaded || busy}
                busyKey={busyKey}
                onApplyCadence={(cadence) =>
                  mutate(`wiki:${preset.id}:${cadence.id}`, () =>
                    existing === null
                      ? createSchedule({
                          name: cadence.scheduleName,
                          jobName: preset.jobName,
                          input: cadence.input,
                          trigger: cadence.trigger,
                          enabled: true,
                        })
                      : updateSchedule({
                          id: existing.id,
                          name: cadence.scheduleName,
                          jobName: preset.jobName,
                          input: cadence.input,
                          trigger: cadence.trigger,
                          enabled: existing.enabled,
                        }),
                  )
                }
                onRun={() =>
                  existing === null
                    ? undefined
                    : mutate(`wiki:${preset.id}:run`, () => runScheduleNow(existing.id))
                }
                onToggle={(enabled) =>
                  existing === null
                    ? undefined
                    : mutate(`wiki:${preset.id}:toggle`, () =>
                        updateSchedule({ id: existing.id, enabled }),
                      )
                }
              />
            );
          })}
        </div>
      </section>

      <AgentPromptScheduler
        name={agentName}
        prompt={agentPrompt}
        cadenceId={selectedAgentCadence.id}
        toolProfile={agentToolProfile}
        disabled={!loaded || busy}
        busy={busyKey === "agent-prompt:create"}
        onNameChange={setAgentName}
        onPromptChange={setAgentPrompt}
        onCadenceChange={setAgentCadenceId}
        onToolProfileChange={setAgentToolProfile}
        onCreate={() => {
          const prompt = agentPrompt.trim();
          if (prompt === "") {
            return;
          }
          const scheduleName = agentName.trim() || selectedAgentCadence.scheduleName;
          mutate("agent-prompt:create", async () => {
            await createSchedule({
              name: scheduleName,
              jobName: "agent.prompt",
              input: {
                prompt,
                title: scheduleName,
                toolProfile: agentToolProfile,
              },
              trigger: selectedAgentCadence.trigger,
              enabled: true,
            });
            setAgentPrompt("");
          });
        }}
      />

      <section className="space-y-3">
        <SectionTitle
          icon={<Activity size={14} strokeWidth={1.75} />}
          title="Configured Schedules"
          count={schedules.length}
        />
        {!loaded ? (
          <ScheduleSkeleton />
        ) : schedules.length === 0 ? (
          <div className="border-y border-[var(--hairline)] py-8 text-center text-[13px] text-[var(--fg-dim)]">
            No schedules configured.
          </div>
        ) : (
          <div className="space-y-5">
            <ScheduleGroup
              title="Source sync"
              schedules={grouped.source}
              disabled={busy}
              onMutate={mutate}
            />
            <ScheduleGroup
              title="Wiki upkeep"
              schedules={grouped.wiki}
              disabled={busy}
              onMutate={mutate}
            />
            <ScheduleGroup
              title="Agent sessions"
              schedules={grouped.agent}
              disabled={busy}
              onMutate={mutate}
            />
            <ScheduleGroup
              title="Other schedules"
              schedules={grouped.advanced}
              disabled={busy}
              onMutate={mutate}
            />
          </div>
        )}
      </section>
    </PageContainer>
  );
}

function ScheduleStats({ stats }: { stats: ReturnType<typeof scheduleStats> }): React.ReactElement {
  return (
    <section className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-[var(--hairline)] bg-[var(--hairline)] md:grid-cols-4">
      <StatCell label="Enabled" value={stats.enabled.toString()} />
      <StatCell label="Disabled" value={stats.disabled.toString()} />
      <StatCell label="Needs Attention" value={stats.needsAttention.toString()} />
      <StatCell label="Next Run" value={stats.nextRun} compact />
    </section>
  );
}

function StatCell({
  label,
  value,
  compact = false,
}: {
  label: string;
  value: string;
  compact?: boolean;
}): React.ReactElement {
  return (
    <div className="min-w-0 bg-[var(--surface)] px-4 py-3">
      <div className="text-[11px] uppercase tracking-[0.12em] text-[var(--fg-mute)]">{label}</div>
      <div
        className={cn(
          "mt-1 font-mono text-[var(--fg)]",
          compact ? "whitespace-normal text-[13px] leading-snug" : "text-[20px] leading-none",
        )}
      >
        {value}
      </div>
    </div>
  );
}

function SectionTitle({
  icon,
  title,
  count,
}: {
  icon: React.ReactNode;
  title: string;
  count: number;
}): React.ReactElement {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[var(--fg-mute)]">{icon}</span>
      <h2 className="text-[13px] font-medium tracking-tight text-[var(--fg)]">{title}</h2>
      <Badge tone="muted">{count}</Badge>
    </div>
  );
}

function ConnectorAutomationCard({
  config,
  status,
  error,
  disabled,
  busyKey,
  onApplyPreset,
  onRun,
  onToggle,
}: {
  config: ConnectorScheduleView;
  status: ConnectorScheduleStatus | null;
  error: string | null;
  disabled: boolean;
  busyKey: string | null;
  onApplyPreset(presetId: string): void;
  onRun(): void;
  onToggle(enabled: boolean): void;
}): React.ReactElement {
  const schedule = status?.schedule ?? null;
  const activePreset = activeConnectorPreset(status);
  const cadenceBusy = Boolean(
    status?.presets.some((preset) => busyKey === `${config.connector}:${preset.id}`),
  );
  return (
    <article className="rounded-md border border-[var(--hairline)] bg-[var(--surface)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-[13px] font-medium text-[var(--fg)]">{config.title}</h3>
            {schedule ? (
              <Badge tone={schedule.enabled ? "ready" : "muted"} pulse={schedule.enabled}>
                {schedule.enabled ? "enabled" : "disabled"}
              </Badge>
            ) : null}
          </div>
          <p className="mt-1 max-w-xl text-[12px] leading-5 text-[var(--fg-dim)]">
            {config.description}
          </p>
        </div>
        {schedule ? (
          <div className="flex flex-wrap gap-2">
            <IconButton
              label="Run now"
              icon={<Play size={13} strokeWidth={2} />}
              disabled={disabled}
              busy={busyKey === `${config.connector}:run`}
              onClick={onRun}
            />
            <IconButton
              label={schedule.enabled ? "Disable" : "Enable"}
              icon={<Pause size={13} strokeWidth={2} />}
              disabled={disabled}
              busy={busyKey === `${config.connector}:toggle`}
              onClick={() => onToggle(!schedule.enabled)}
            />
          </div>
        ) : null}
      </div>

      <dl className="mt-4 grid gap-3 border-y border-[var(--hairline)] py-3 text-[12px] sm:grid-cols-3">
        <CadenceDropdown
          value={activePreset?.id ?? null}
          options={status?.presets ?? []}
          disabled={disabled || status === null}
          busy={cadenceBusy}
          customLabel={schedule === null ? "Not scheduled" : "Custom cadence"}
          customDescription={
            schedule === null
              ? "Choose a cadence to create this source sync."
              : `Current custom interval: ${formatTrigger(schedule.trigger)}.`
          }
          onChange={onApplyPreset}
        />
        <Metric label="Next" value={schedule ? formatTime(schedule.nextRunAt) : "not scheduled"} />
        <Metric label="Last" value={schedule ? formatTime(schedule.lastRunAt) : "never"} />
        <Metric label="Profile" value={connectorProfileLabel(status)} />
        <Metric label="Job" value={schedule ? friendlySchedule(schedule).label : "Source sync"} />
        <Metric label="Last status" value={schedule?.lastStatus ?? "none"} />
      </dl>

      {error ? <InlineError message={error} /> : null}
    </article>
  );
}

function WikiAutomationCard({
  preset,
  schedule,
  disabled,
  busyKey,
  onApplyCadence,
  onRun,
  onToggle,
}: {
  preset: WikiAutomationPreset;
  schedule: JobSchedule | null;
  disabled: boolean;
  busyKey: string | null;
  onApplyCadence(cadence: WikiAutomationCadence): void;
  onRun(): void | undefined;
  onToggle(enabled: boolean): void | undefined;
}): React.ReactElement {
  const activeCadence = activeWikiCadence(schedule, preset);
  const cadenceBusy = preset.cadences.some(
    (cadence) => busyKey === `wiki:${preset.id}:${cadence.id}`,
  );
  return (
    <article className="rounded-md border border-[var(--hairline)] bg-[var(--surface)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-[13px] font-medium text-[var(--fg)]">{preset.title}</h3>
            {schedule ? (
              <Badge tone={schedule.enabled ? "ready" : "muted"} pulse={schedule.enabled}>
                {schedule.enabled ? "enabled" : "disabled"}
              </Badge>
            ) : null}
          </div>
          <p className="mt-1 max-w-xl text-[12px] leading-5 text-[var(--fg-dim)]">
            {preset.description}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {schedule ? (
            <>
              <IconButton
                label="Run now"
                icon={<Play size={13} strokeWidth={2} />}
                disabled={disabled}
                busy={busyKey === `wiki:${preset.id}:run`}
                onClick={onRun}
              />
              <IconButton
                label={schedule.enabled ? "Disable" : "Enable"}
                icon={<Pause size={13} strokeWidth={2} />}
                disabled={disabled}
                busy={busyKey === `wiki:${preset.id}:toggle`}
                onClick={() => onToggle(!schedule.enabled)}
              />
            </>
          ) : null}
        </div>
      </div>

      <dl className="mt-4 grid gap-3 border-y border-[var(--hairline)] py-3 text-[12px] sm:grid-cols-3">
        <CadenceDropdown
          value={activeCadence?.id ?? null}
          options={preset.cadences}
          disabled={disabled}
          busy={cadenceBusy}
          customLabel={schedule === null ? "Not scheduled" : "Custom cadence"}
          customDescription={
            schedule === null
              ? "Choose a cadence to create this automation."
              : `Current custom interval: ${formatTrigger(schedule.trigger)}.`
          }
          onChange={(cadenceId) => {
            const cadence = preset.cadences.find((option) => option.id === cadenceId);
            if (cadence !== undefined) {
              onApplyCadence(cadence);
            }
          }}
        />
        <Metric label="Next" value={schedule ? formatTime(schedule.nextRunAt) : "not scheduled"} />
        <Metric label="Last" value={schedule ? formatTime(schedule.lastRunAt) : "never"} />
      </dl>
    </article>
  );
}

function ScheduleGroup({
  title,
  schedules,
  disabled,
  onMutate,
}: {
  title: string;
  schedules: JobSchedule[];
  disabled: boolean;
  onMutate(key: string, operation: () => Promise<unknown>): void;
}): React.ReactElement | null {
  if (schedules.length === 0) {
    return null;
  }
  return (
    <section className="space-y-2">
      <div className="label-eyebrow text-[var(--fg-mute)]">{title}</div>
      <div className="divide-y divide-[var(--hairline)] border-y border-[var(--hairline)]">
        {schedules.map((schedule) => (
          <ScheduleRow
            key={schedule.id}
            schedule={schedule}
            disabled={disabled}
            onMutate={onMutate}
          />
        ))}
      </div>
    </section>
  );
}

function ScheduleRow({
  schedule,
  disabled,
  onMutate,
}: {
  schedule: JobSchedule;
  disabled: boolean;
  onMutate(key: string, operation: () => Promise<unknown>): void;
}): React.ReactElement {
  const info = friendlySchedule(schedule);
  const statusTone =
    schedule.lastStatus === "failed" ? "bad" : schedule.enabled ? "ready" : "muted";
  return (
    <article className="grid gap-3 py-4 lg:grid-cols-[minmax(0,1fr)_auto]">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[var(--fg-mute)]">{info.icon}</span>
          <h3 className="text-[13.5px] font-medium tracking-tight text-[var(--fg)]">
            {schedule.name}
          </h3>
          <Badge tone={statusTone} pulse={schedule.enabled}>
            {schedule.enabled ? "enabled" : "disabled"}
          </Badge>
          {schedule.lastStatus ? (
            <Badge tone={schedule.lastStatus === "completed" ? "ready" : "bad"}>
              {schedule.lastStatus}
            </Badge>
          ) : null}
        </div>
        <p className="mt-1 text-[12px] leading-5 text-[var(--fg-dim)]">{info.description}</p>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11.5px] text-[var(--fg-mute)]">
          <span>{info.label}</span>
          <span>{formatTrigger(schedule.trigger)}</span>
          <span>next {formatTime(schedule.nextRunAt)}</span>
          <span>last {formatTime(schedule.lastRunAt)}</span>
        </div>
        {schedule.lastError ? <InlineError message={schedule.lastError} /> : null}
      </div>

      <div className="flex flex-wrap gap-2 lg:justify-end">
        <IconButton
          label="Run"
          icon={<Play size={13} strokeWidth={2} />}
          disabled={disabled}
          onClick={() => onMutate(`${schedule.id}:run`, () => runScheduleNow(schedule.id))}
        />
        <IconButton
          label={schedule.enabled ? "Disable" : "Enable"}
          icon={<Pause size={13} strokeWidth={2} />}
          disabled={disabled}
          onClick={() =>
            onMutate(`${schedule.id}:toggle`, () =>
              updateSchedule({ id: schedule.id, enabled: !schedule.enabled }),
            )
          }
        />
        <IconButton
          label="Delete"
          icon={<Trash2 size={13} strokeWidth={2} />}
          disabled={disabled}
          onClick={() => onMutate(`${schedule.id}:delete`, () => deleteSchedule(schedule.id))}
        />
      </div>
    </article>
  );
}

function AgentPromptScheduler({
  name,
  prompt,
  cadenceId,
  toolProfile,
  disabled,
  busy,
  onNameChange,
  onPromptChange,
  onCadenceChange,
  onToolProfileChange,
  onCreate,
}: {
  name: string;
  prompt: string;
  cadenceId: string;
  toolProfile: AgentPromptToolProfile;
  disabled: boolean;
  busy: boolean;
  onNameChange(value: string): void;
  onPromptChange(value: string): void;
  onCadenceChange(value: string): void;
  onToolProfileChange(value: AgentPromptToolProfile): void;
  onCreate(): void;
}): React.ReactElement {
  const selectedCadence = agentPromptCadence(cadenceId);
  const canCreate = prompt.trim() !== "" && !disabled && !busy;

  return (
    <section className="space-y-3">
      <SectionTitle
        icon={<Bot size={14} strokeWidth={1.75} />}
        title="Agent Sessions"
        count={AGENT_PROMPT_CADENCES.length}
      />
      <article className="rounded-md border border-[var(--hairline)] bg-[var(--surface)] p-4">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <label className="space-y-1.5">
            <span className="text-[12px] text-[var(--fg-dim)]">Prompt</span>
            <Textarea
              value={prompt}
              onChange={(event) => onPromptChange(event.target.value)}
              placeholder="Ask Strata to review open actions, prepare a daily brief, audit recent source activity..."
              spellCheck={true}
              className="min-h-36 text-[13px]"
            />
          </label>

          <div className="space-y-3">
            <label className="space-y-1.5">
              <span className="text-[12px] text-[var(--fg-dim)]">Name</span>
              <Input
                value={name}
                onChange={(event) => onNameChange(event.target.value)}
                placeholder={selectedCadence.scheduleName}
              />
            </label>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
              <label className="space-y-1.5">
                <span className="text-[12px] text-[var(--fg-dim)]">Cadence</span>
                <select
                  value={cadenceId}
                  onChange={(event) => onCadenceChange(event.target.value)}
                  className="h-9 w-full rounded-md border border-[var(--hairline)] bg-[var(--bg)] px-3 text-[12px] text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                >
                  {AGENT_PROMPT_CADENCES.map((cadence) => (
                    <option key={cadence.id} value={cadence.id}>
                      {cadence.label} - {formatTrigger(cadence.trigger)}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-1.5">
                <span className="text-[12px] text-[var(--fg-dim)]">Tool access</span>
                <select
                  value={toolProfile}
                  onChange={(event) =>
                    onToolProfileChange(event.target.value as AgentPromptToolProfile)
                  }
                  className="h-9 w-full rounded-md border border-[var(--hairline)] bg-[var(--bg)] px-3 text-[12px] text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                >
                  {AGENT_TOOL_PROFILE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="rounded-md border border-[var(--hairline)] bg-[var(--bg)] p-3">
              <p className="text-[12px] font-medium text-[var(--fg)]">
                {selectedCadence.description}
              </p>
              <p className="mt-1 text-[12px] leading-5 text-[var(--fg-dim)]">
                {toolProfileDescription(toolProfile)}
              </p>
            </div>

            <Button
              type="button"
              size="sm"
              disabled={!canCreate}
              onClick={onCreate}
              className="w-full justify-center"
            >
              {busy ? (
                <RotateCw size={13} strokeWidth={2} className="animate-spin" />
              ) : (
                <Plus size={13} strokeWidth={2} />
              )}
              Schedule Agent Session
            </Button>
          </div>
        </div>
      </article>
    </section>
  );
}

function IconButton({
  label,
  icon,
  disabled,
  busy = false,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  disabled: boolean;
  busy?: boolean;
  onClick?(): void;
}): React.ReactElement {
  return (
    <Button
      type="button"
      size="sm"
      variant="secondary"
      disabled={disabled || onClick === undefined}
      onClick={onClick}
      className="h-8 px-2 text-[12px]"
    >
      {busy ? <RotateCw size={13} strokeWidth={2} className="animate-spin" /> : icon}
      {label}
    </Button>
  );
}

function CadenceDropdown({
  value,
  options,
  disabled,
  busy,
  customLabel,
  customDescription,
  onChange,
}: {
  value: string | null;
  options: CadenceOption[];
  disabled: boolean;
  busy: boolean;
  customLabel: string;
  customDescription: string;
  onChange(value: string): void;
}): React.ReactElement {
  const active = options.find((option) => option.id === value) ?? null;
  const triggerLabel = active?.label ?? customLabel;
  const triggerDetail = active === null ? "Choose cadence" : formatTrigger(active.trigger);

  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-[var(--fg-mute)]">Cadence</dt>
      <dd className="mt-1">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={disabled || options.length === 0}
              className="h-auto min-h-8 w-full justify-between gap-2 px-2 py-1.5 text-left text-[12px]"
            >
              <span className="grid min-w-0 gap-0.5">
                <span className="truncate font-medium text-[var(--fg)]">{triggerLabel}</span>
                <span className="truncate font-mono text-[11px] text-[var(--fg-mute)]">
                  {triggerDetail}
                </span>
              </span>
              {busy ? (
                <RotateCw
                  size={13}
                  strokeWidth={2}
                  className="shrink-0 animate-spin text-[var(--accent)]"
                />
              ) : (
                <ChevronDown size={13} strokeWidth={2} className="shrink-0 text-[var(--fg-mute)]" />
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="w-80 border-[var(--hairline)] bg-[var(--surface)] p-1.5 text-[var(--fg)]"
          >
            <DropdownMenuLabel className="px-2 py-1 text-[11px] uppercase tracking-[0.12em] text-[var(--fg-mute)]">
              Cadence
            </DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={value ?? ""}
              onValueChange={(nextValue) => {
                if (nextValue !== "" && nextValue !== value) {
                  onChange(nextValue);
                }
              }}
            >
              {options.map((option) => (
                <DropdownMenuRadioItem
                  key={option.id}
                  value={option.id}
                  disabled={disabled}
                  className="items-start rounded-md py-2 pr-2 text-[13px] focus:bg-[var(--surface-2)]"
                >
                  <span className="grid min-w-0 gap-0.5">
                    <span className="font-medium text-[var(--fg)]">{option.label}</span>
                    <span className="text-[11.5px] leading-snug text-[var(--fg-mute)]">
                      {option.description}
                    </span>
                    <span className="font-mono text-[11px] text-[var(--fg-mute)]">
                      {formatTrigger(option.trigger)}
                    </span>
                  </span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            {active === null ? (
              <>
                <DropdownMenuSeparator className="my-1 bg-[var(--hairline)]" />
                <DropdownMenuItem
                  disabled
                  className="items-start rounded-md py-2 text-[12px] text-[var(--fg-mute)]"
                >
                  <span className="grid gap-0.5">
                    <span className="font-medium text-[var(--fg-dim)]">{customLabel}</span>
                    <span className="text-[11.5px] leading-snug">{customDescription}</span>
                  </span>
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </dd>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-[var(--fg-mute)]">{label}</dt>
      <dd className="truncate text-[12px] text-[var(--fg-dim)]">{value}</dd>
    </div>
  );
}

function ErrorCallout({ label, message }: { label: string; message: string }): React.ReactElement {
  return (
    <div className="rounded-md border border-[var(--bad)]/40 bg-[var(--bad)]/[0.06] p-3">
      <p className="font-mono text-[12px] text-[var(--bad)]">{label}</p>
      <p className="mt-1 text-[13px] text-[var(--fg-dim)]">{message}</p>
    </div>
  );
}

function InlineError({ message }: { message: string }): React.ReactElement {
  return (
    <p className="mt-3 rounded-sm bg-[var(--bad)]/10 px-2 py-1.5 font-mono text-[11px] text-[var(--bad)]">
      {message}
    </p>
  );
}

function ScheduleSkeleton(): React.ReactElement {
  return (
    <div className="divide-y divide-[var(--hairline)] border-y border-[var(--hairline)]">
      {Array.from({ length: 3 }, (_, index) => (
        <div key={index} className="space-y-2 py-4">
          <div className="h-3 w-48 rounded-sm bg-[var(--surface-2)]" />
          <div className="h-2.5 w-80 max-w-full rounded-sm bg-[var(--surface-2)]" />
        </div>
      ))}
    </div>
  );
}

function findPresetSchedule(
  schedules: JobSchedule[],
  preset: WikiAutomationPreset,
): JobSchedule | null {
  return schedules.find((schedule) => schedule.jobName === preset.jobName) ?? null;
}

function activeConnectorPreset(status: ConnectorScheduleStatus | null): CadenceOption | null {
  const schedule = status?.schedule ?? null;
  if (schedule === null || status === null) {
    return null;
  }
  return status.presets.find((preset) => scheduleMatchesCadence(schedule, preset)) ?? null;
}

function activeWikiCadence(
  schedule: JobSchedule | null,
  preset: WikiAutomationPreset,
): WikiAutomationCadence | null {
  if (schedule === null) {
    return null;
  }
  return preset.cadences.find((cadence) => scheduleMatchesCadence(schedule, cadence)) ?? null;
}

function scheduleMatchesCadence(schedule: JobSchedule, cadence: CadenceOption): boolean {
  return schedule.name === cadence.scheduleName || triggersEqual(schedule.trigger, cadence.trigger);
}

function triggersEqual(left: JobSchedule["trigger"], right: JobSchedule["trigger"]): boolean {
  if (left.type !== right.type) {
    return false;
  }
  if (left.type === "interval") {
    return right.type === "interval" && left.seconds === right.seconds;
  }
  return right.type === "cron" && left.expression === right.expression;
}

function scheduleStats(schedules: JobSchedule[]): {
  enabled: number;
  disabled: number;
  needsAttention: number;
  nextRun: string;
} {
  let enabled = 0;
  let needsAttention = 0;
  let nextRunAt: string | null = null;
  for (const schedule of schedules) {
    if (schedule.enabled) {
      enabled += 1;
      if (schedule.nextRunAt !== null && (nextRunAt === null || schedule.nextRunAt < nextRunAt)) {
        nextRunAt = schedule.nextRunAt;
      }
    }
    if (schedule.lastStatus === "failed" || schedule.lastError !== null) {
      needsAttention += 1;
    }
  }
  return {
    enabled,
    disabled: schedules.length - enabled,
    needsAttention,
    nextRun: formatTime(nextRunAt),
  };
}

function groupSchedules(schedules: JobSchedule[]): Record<ScheduleCategory, JobSchedule[]> {
  const groups: Record<ScheduleCategory, JobSchedule[]> = {
    source: [],
    wiki: [],
    agent: [],
    advanced: [],
  };
  for (const schedule of schedules) {
    groups[scheduleCategory(schedule)].push(schedule);
  }
  return groups;
}

function scheduleCategory(schedule: JobSchedule): ScheduleCategory {
  if (schedule.jobName === "connector.pull") {
    return "source";
  }
  if (schedule.jobName === "wiki.hygiene" || schedule.jobName === "wiki.search-index.refresh") {
    return "wiki";
  }
  if (schedule.jobName === "agent.prompt") {
    return "agent";
  }
  return "advanced";
}

function friendlySchedule(schedule: JobSchedule): {
  label: string;
  description: string;
  icon: React.ReactNode;
} {
  if (schedule.jobName === "connector.pull") {
    const connector = stringInput(schedule.input.connector);
    if (connector === "granola") {
      return {
        label: "Granola source sync",
        description:
          "Pulls recent Granola notes, writes raw snapshots, organizes them into wiki pages, and refreshes retrieval when enabled.",
        icon: <Database size={13} strokeWidth={1.75} />,
      };
    }
    if (connector === "slack") {
      return {
        label: "Slack source sync",
        description:
          "Polls Slack history, writes material raw thread snapshots, indexes durable items, and updates search when enabled.",
        icon: <Database size={13} strokeWidth={1.75} />,
      };
    }
    return {
      label: `${connector ?? "Connector"} source sync`,
      description:
        "Runs a connector pull or dry-run with optional raw-to-wiki indexing and search refresh.",
      icon: <Database size={13} strokeWidth={1.75} />,
    };
  }
  if (schedule.jobName === "raw.index") {
    return {
      label: "Raw source indexing",
      description:
        "Organizes existing raw snapshots into curated wiki/source pages without pulling new source data.",
      icon: <FileSearch size={13} strokeWidth={1.75} />,
    };
  }
  if (schedule.jobName === "wiki.search-index.refresh") {
    return {
      label: "Search refresh",
      description: "Rebuilds the local retrieval index used by wiki search and agent context.",
      icon: <FileSearch size={13} strokeWidth={1.75} />,
    };
  }
  if (schedule.jobName === "wiki.hygiene") {
    return {
      label: "Wiki hygiene",
      description:
        "Stages entity-consolidation proposals and refreshes retrieval without silently rewriting wiki pages.",
      icon: <BookOpenCheck size={13} strokeWidth={1.75} />,
    };
  }
  if (schedule.jobName === "agent.prompt") {
    const prompt = stringInput(schedule.input.prompt);
    const toolProfile = stringInput(schedule.input.toolProfile) ?? "maintenance";
    return {
      label: `Agent session: ${toolProfileLabel(toolProfile)}`,
      description:
        prompt === null
          ? "Starts an agent session from a scheduled prompt."
          : `Starts an agent session from: ${truncateText(prompt, 180)}`,
      icon: <Bot size={13} strokeWidth={1.75} />,
    };
  }
  if (schedule.jobName === "maintenance.run") {
    return {
      label: `Maintenance: ${stringInput(schedule.input.jobName) ?? "job"}`,
      description: "Runs one registered maintenance audit and records its trace/report.",
      icon: <Activity size={13} strokeWidth={1.75} />,
    };
  }
  return {
    label: schedule.jobName,
    description: "Runs a registered local job through the shared scheduler.",
    icon: <Settings2 size={13} strokeWidth={1.75} />,
  };
}

function connectorProfileLabel(status: ConnectorScheduleStatus | null): string {
  if (status?.scheduleProfile) {
    return status.scheduleProfile.label;
  }
  if (status?.scheduleProfileMissing) {
    return `missing ${status.scheduleProfileMissing}`;
  }
  return "none";
}

function stringInput(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function agentPromptCadence(value: string): AgentPromptCadence {
  return AGENT_PROMPT_CADENCES.find((cadence) => cadence.id === value) ?? AGENT_PROMPT_CADENCES[1]!;
}

function toolProfileDescription(profile: AgentPromptToolProfile): string {
  return (
    AGENT_TOOL_PROFILE_OPTIONS.find((option) => option.value === profile)?.description ??
    AGENT_TOOL_PROFILE_OPTIONS[0]!.description
  );
}

function toolProfileLabel(profile: string): string {
  return AGENT_TOOL_PROFILE_OPTIONS.find((option) => option.value === profile)?.label ?? profile;
}

function truncateText(value: string, limit: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= limit) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, limit - 3)).trimEnd()}...`;
}

function formatTrigger(trigger: JobSchedule["trigger"]): string {
  if (trigger.type === "interval") {
    const seconds = trigger.seconds;
    if (seconds % 86_400 === 0) {
      const days = seconds / 86_400;
      return `every ${days}d`;
    }
    if (seconds % 3_600 === 0) {
      const hours = seconds / 3_600;
      return `every ${hours}h`;
    }
    if (seconds % 60 === 0) {
      const minutes = seconds / 60;
      return `every ${minutes}m`;
    }
    return `every ${seconds}s`;
  }
  return trigger.expression;
}

function formatTime(value: string | null | undefined): string {
  if (!value) {
    return "never";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
