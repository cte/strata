import { ListFilter, Plus, RefreshCw, Tags } from "lucide-react";
import type * as React from "react";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { PageContainer, PageHeader } from "@/components/page-layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  addIngestTaxonomyProjectAlias,
  addIngestTaxonomySelfName,
  addIngestTaxonomySlackPattern,
  getIngestTaxonomy,
  type IngestTaxonomy,
  type IngestTaxonomyMutationResult,
  type IngestTaxonomyResult,
} from "@/lib/api";
import { cn } from "@/lib/utils";

type SlackField =
  | "materialPatterns"
  | "ignoredLogPatterns"
  | "transientCheckPatterns"
  | "routineCoordinationPatterns"
  | "statusOnlyPatterns";

const SLACK_FIELDS: { label: string; value: SlackField }[] = [
  { label: "Material", value: "materialPatterns" },
  { label: "Ignored log", value: "ignoredLogPatterns" },
  { label: "Transient check", value: "transientCheckPatterns" },
  { label: "Routine coordination", value: "routineCoordinationPatterns" },
  { label: "Status only", value: "statusOnlyPatterns" },
];

export function IngestTaxonomyPage(): React.ReactElement {
  const [result, setResult] = useState<IngestTaxonomyResult | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const refresh = useCallback(async () => {
    setError(null);
    setResult(await getIngestTaxonomy());
    setLoaded(true);
  }, []);

  useEffect(() => {
    let cancelled = false;
    getIngestTaxonomy().then(
      (next) => {
        if (!cancelled) {
          setResult(next);
          setLoaded(true);
        }
      },
      (cause: unknown) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : String(cause));
          setLoaded(true);
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const taxonomy = result?.taxonomy ?? { version: 1 };
  const totals = useMemo(() => taxonomyTotals(taxonomy), [taxonomy]);

  const handleRefresh = () => {
    startTransition(async () => {
      try {
        await refresh();
      } catch (cause: unknown) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    });
  };

  const finishMutation = async (mutationResult: IngestTaxonomyMutationResult) => {
    setMessage(mutationResultMessage(mutationResult));
    await refresh();
  };

  return (
    <PageContainer width="wide">
      <PageHeader
        icon={<Tags size={15} strokeWidth={1.75} />}
        title="Ingest Taxonomy"
        description="Local raw-to-wiki aliases and source filters."
        actions={
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={handleRefresh}
            disabled={isPending}
          >
            <RefreshCw size={13} strokeWidth={2} className={cn(isPending && "animate-spin")} />
            Refresh
          </Button>
        }
      />

      {error ? <StatusBlock tone="bad" label="taxonomy error" message={error} /> : null}
      {message ? <StatusBlock tone="ready" label="taxonomy update" message={message} /> : null}

      <TaxonomyStats result={result} loaded={loaded} totals={totals} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section className="min-w-0 space-y-6">
          <ProjectTaxonomy taxonomy={taxonomy} />
          <SlackTaxonomy taxonomy={taxonomy} />
        </section>
        <aside className="space-y-4">
          <ProjectAliasForm onDone={finishMutation} onError={setError} />
          <SelfNameForm onDone={finishMutation} onError={setError} />
          <SlackPatternForm onDone={finishMutation} onError={setError} />
        </aside>
      </div>
    </PageContainer>
  );
}

function TaxonomyStats({
  result,
  loaded,
  totals,
}: {
  result: IngestTaxonomyResult | null;
  loaded: boolean;
  totals: ReturnType<typeof taxonomyTotals>;
}): React.ReactElement {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      <TaxonomyStat label="projects" value={totals.projects} />
      <TaxonomyStat label="aliases" value={totals.aliases} />
      <TaxonomyStat label="self names" value={totals.selfNames} />
      <TaxonomyStat label="slack rules" value={totals.slackRules} />
      <div className="rounded-md border border-[var(--hairline)] bg-[var(--surface)] px-3 py-3">
        <span className="label-eyebrow text-[var(--fg-mute)]">file</span>
        <p className="mt-1 truncate font-mono text-[12px] text-[var(--fg)]">
          {!loaded ? "loading" : (result?.path ?? "missing")}
        </p>
        <div className="mt-2">
          <Badge tone={result?.found ? "ready" : "muted"}>
            {result?.source?.replace("_", " ") ?? "empty"}
          </Badge>
        </div>
      </div>
    </div>
  );
}

function TaxonomyStat({ label, value }: { label: string; value: number }): React.ReactElement {
  return (
    <div className="rounded-md border border-[var(--hairline)] bg-[var(--surface)] px-3 py-3">
      <span className="label-eyebrow text-[var(--fg-mute)]">{label}</span>
      <p className="mt-1 font-mono text-[18px] text-[var(--fg)]">{value.toLocaleString()}</p>
    </div>
  );
}

function ProjectTaxonomy({ taxonomy }: { taxonomy: IngestTaxonomy }): React.ReactElement {
  const projects = taxonomy.projects ?? [];
  return (
    <section className="border-y border-[var(--hairline)]">
      <SectionHeader icon={<Tags size={14} />} title="Projects" count={projects.length} />
      <div className="divide-y divide-[var(--hairline)]">
        {projects.length === 0 ? (
          <EmptyRow label="No project aliases configured." />
        ) : (
          projects.map((project) => (
            <div key={project.label} className="grid gap-2 py-3 md:grid-cols-[180px_minmax(0,1fr)]">
              <p className="truncate text-[13px] font-medium text-[var(--fg)]">{project.label}</p>
              <div className="flex min-w-0 flex-wrap gap-1.5">
                {(project.aliases ?? []).length === 0 ? (
                  <span className="text-[12px] text-[var(--fg-mute)]">canonical label only</span>
                ) : (
                  project.aliases?.map((alias) => (
                    <span
                      key={alias}
                      className="rounded border border-[var(--hairline)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--fg-dim)]"
                    >
                      {alias}
                    </span>
                  ))
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function SlackTaxonomy({ taxonomy }: { taxonomy: IngestTaxonomy }): React.ReactElement {
  const slack = taxonomy.slack ?? {};
  return (
    <section className="border-y border-[var(--hairline)]">
      <SectionHeader
        icon={<ListFilter size={14} />}
        title="Slack Patterns"
        count={slackRuleCount(taxonomy)}
      />
      <div className="divide-y divide-[var(--hairline)]">
        {SLACK_FIELDS.map((field) => {
          const rules = slack[field.value] ?? [];
          return (
            <div key={field.value} className="grid gap-2 py-3 md:grid-cols-[180px_minmax(0,1fr)]">
              <p className="text-[13px] font-medium text-[var(--fg)]">{field.label}</p>
              <div className="min-w-0 space-y-1.5">
                {rules.length === 0 ? (
                  <span className="text-[12px] text-[var(--fg-mute)]">No local patterns.</span>
                ) : (
                  rules.map((rule) => (
                    <div key={`${rule.match ?? "literal"}:${rule.value}`} className="min-w-0">
                      <p className="truncate font-mono text-[12px] text-[var(--fg)]">
                        {rule.value}
                      </p>
                      <p className="text-[11px] text-[var(--fg-mute)]">
                        {rule.match ?? "literal"}
                        {rule.reason ? ` · ${rule.reason}` : ""}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function SectionHeader({
  icon,
  title,
  count,
}: {
  icon: React.ReactNode;
  title: string;
  count: number;
}): React.ReactElement {
  return (
    <div className="flex items-center justify-between gap-3 py-3">
      <div className="flex items-center gap-2 text-[var(--fg)]">
        <span className="text-[var(--fg-mute)]">{icon}</span>
        <h2 className="text-[13px] font-semibold tracking-tight">{title}</h2>
      </div>
      <Badge tone="muted">{count.toLocaleString()}</Badge>
    </div>
  );
}

function ProjectAliasForm({
  onDone,
  onError,
}: {
  onDone(result: IngestTaxonomyMutationResult): Promise<void>;
  onError(message: string | null): void;
}): React.ReactElement {
  const [label, setLabel] = useState("");
  const [alias, setAlias] = useState("");
  const [propose, setPropose] = useState(true);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    onError(null);
    try {
      await onDone(await addIngestTaxonomyProjectAlias({ label, aliases: [alias], propose }));
      setAlias("");
    } catch (cause: unknown) {
      onError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <FormShell title="Project Alias">
      <TextInput label="Label" value={label} onChange={setLabel} />
      <TextInput label="Alias" value={alias} onChange={setAlias} />
      <FormFooter propose={propose} setPropose={setPropose} busy={busy} onSubmit={submit} />
    </FormShell>
  );
}

function SelfNameForm({
  onDone,
  onError,
}: {
  onDone(result: IngestTaxonomyMutationResult): Promise<void>;
  onError(message: string | null): void;
}): React.ReactElement {
  const [name, setName] = useState("");
  const [propose, setPropose] = useState(true);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    onError(null);
    try {
      await onDone(await addIngestTaxonomySelfName({ name, propose }));
      setName("");
    } catch (cause: unknown) {
      onError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <FormShell title="Self Name">
      <TextInput label="Name" value={name} onChange={setName} />
      <FormFooter propose={propose} setPropose={setPropose} busy={busy} onSubmit={submit} />
    </FormShell>
  );
}

function SlackPatternForm({
  onDone,
  onError,
}: {
  onDone(result: IngestTaxonomyMutationResult): Promise<void>;
  onError(message: string | null): void;
}): React.ReactElement {
  const [field, setField] = useState<SlackField>("materialPatterns");
  const [value, setValue] = useState("");
  const [match, setMatch] = useState<"literal" | "regex">("literal");
  const [reason, setReason] = useState("");
  const [propose, setPropose] = useState(true);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    onError(null);
    try {
      await onDone(
        await addIngestTaxonomySlackPattern({
          field,
          rule: {
            value,
            match,
            ...(reason.trim() === "" ? {} : { reason: reason.trim() }),
          },
          propose,
        }),
      );
      setValue("");
    } catch (cause: unknown) {
      onError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <FormShell title="Slack Pattern">
      <label className="space-y-1.5">
        <span className="label-eyebrow text-[var(--fg-mute)]">Field</span>
        <select
          value={field}
          onChange={(event) => setField(event.target.value as SlackField)}
          className="h-9 w-full rounded-md border border-[var(--hairline)] bg-[var(--bg)] px-2 text-[13px] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
        >
          {SLACK_FIELDS.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
      </label>
      <TextInput label="Value" value={value} onChange={setValue} />
      <label className="space-y-1.5">
        <span className="label-eyebrow text-[var(--fg-mute)]">Match</span>
        <select
          value={match}
          onChange={(event) => setMatch(event.target.value as "literal" | "regex")}
          className="h-9 w-full rounded-md border border-[var(--hairline)] bg-[var(--bg)] px-2 text-[13px] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
        >
          <option value="literal">Literal</option>
          <option value="regex">Regex</option>
        </select>
      </label>
      <TextInput label="Reason" value={reason} onChange={setReason} />
      <FormFooter propose={propose} setPropose={setPropose} busy={busy} onSubmit={submit} />
    </FormShell>
  );
}

function FormShell({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <section className="space-y-3 rounded-md border border-[var(--hairline)] bg-[var(--surface)] p-3">
      <h2 className="text-[13px] font-semibold tracking-tight text-[var(--fg)]">{title}</h2>
      {children}
    </section>
  );
}

function TextInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange(value: string): void;
}): React.ReactElement {
  return (
    <label className="space-y-1.5">
      <span className="label-eyebrow text-[var(--fg-mute)]">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 w-full rounded-md border border-[var(--hairline)] bg-[var(--bg)] px-2 text-[13px] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
      />
    </label>
  );
}

function FormFooter({
  propose,
  setPropose,
  busy,
  onSubmit,
}: {
  propose: boolean;
  setPropose(value: boolean): void;
  busy: boolean;
  onSubmit(): Promise<void>;
}): React.ReactElement {
  return (
    <div className="flex items-center justify-between gap-3 pt-1">
      <label className="flex items-center gap-2 text-[12px] text-[var(--fg-dim)]">
        <input
          type="checkbox"
          checked={propose}
          onChange={(event) => setPropose(event.target.checked)}
          className="h-3.5 w-3.5 accent-[var(--accent)]"
        />
        Propose
      </label>
      <Button type="button" size="sm" onClick={onSubmit} disabled={busy}>
        <Plus size={13} strokeWidth={2} />
        Add
      </Button>
    </div>
  );
}

function StatusBlock({
  tone,
  label,
  message,
}: {
  tone: "bad" | "ready";
  label: string;
  message: string;
}): React.ReactElement {
  const color = tone === "bad" ? "var(--bad)" : "var(--good)";
  return (
    <div className="rounded-md border p-3" style={{ borderColor: color }}>
      <p className="font-mono text-[12px]" style={{ color }}>
        {label}
      </p>
      <p className="mt-1 text-[13px] text-[var(--fg-dim)]">{message}</p>
    </div>
  );
}

function EmptyRow({ label }: { label: string }): React.ReactElement {
  return <div className="py-8 text-center text-[13px] text-[var(--fg-dim)]">{label}</div>;
}

function taxonomyTotals(taxonomy: IngestTaxonomy): {
  projects: number;
  aliases: number;
  selfNames: number;
  slackRules: number;
} {
  const projects = taxonomy.projects ?? [];
  return {
    projects: projects.length,
    aliases: projects.reduce((sum, project) => sum + (project.aliases?.length ?? 0), 0),
    selfNames: taxonomy.selfNames?.length ?? 0,
    slackRules: slackRuleCount(taxonomy),
  };
}

function slackRuleCount(taxonomy: IngestTaxonomy): number {
  const slack = taxonomy.slack ?? {};
  return SLACK_FIELDS.reduce((sum, field) => sum + (slack[field.value]?.length ?? 0), 0);
}

function mutationResultMessage(result: IngestTaxonomyMutationResult): string {
  if ("proposal" in result) {
    return `Proposal staged at ${result.proposal.path}.`;
  }
  return `${result.changed ? "Updated" : "Already present"} ${result.path}.`;
}
