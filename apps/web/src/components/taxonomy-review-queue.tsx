import { Check, ChevronRight, Inbox, RefreshCw, Sparkles } from "lucide-react";
import type * as React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Callout } from "@/components/shared/callout";
import { Eyebrow } from "@/components/shared/eyebrow";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  correctTaxonomyReview,
  getWikiPage,
  listTaxonomyReview,
  type TaxonomyReviewItem,
} from "@/lib/api";
import { cn } from "@/lib/utils";

type Verdict = "confirm" | "unrecognized_project" | "wrong_project" | "noise" | "is_me";

const VERDICTS: { value: Verdict; label: string; needs: ("project" | "ignore" | "self")[] }[] = [
  { value: "confirm", label: "Looks right — no change", needs: [] },
  { value: "unrecognized_project", label: "Unrecognized project", needs: ["project"] },
  { value: "wrong_project", label: "Wrong project", needs: ["project"] },
  { value: "noise", label: "Noise — shouldn't be indexed", needs: ["ignore"] },
  { value: "is_me", label: "This mentions me", needs: ["self"] },
];

/**
 * The daily review queue for taxonomy building (docs/taxonomy-suggestion-plan.md).
 * Surfaces raw-to-wiki classification outcomes the taxonomy didn't explain; the
 * reviewer confirms or corrects each, which records a Classification correction
 * and applies the fixing taxonomy operation immediately (no second approval).
 */
export function TaxonomyReviewQueue(): React.ReactElement {
  const [items, setItems] = useState<TaxonomyReviewItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState<TaxonomyReviewItem | null>(null);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setItems(await listTaxonomyReview({ source: "all", limit: 50 }));
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = useCallback(
    async (item: TaxonomyReviewItem, verdict: Verdict, fields: CorrectionFields) => {
      setBusy(true);
      setError(null);
      try {
        const result = await correctTaxonomyReview({
          dedupeKey: item.dedupeKey,
          source: item.source,
          targetSessionId: item.sessionId,
          targetEventId: item.eventId,
          rawPath: item.rawPath,
          title: item.title,
          projectPaths: item.projectPaths,
          reviewReason: item.reviewReason,
          verdict,
          ...(fields.projectLabel ? { projectLabel: fields.projectLabel } : {}),
          ...(fields.aliases.length > 0 ? { aliases: fields.aliases } : {}),
          ...(fields.selfName ? { selfName: fields.selfName } : {}),
          ...(fields.ignorePattern ? { ignorePattern: fields.ignorePattern } : {}),
        });
        setItems((current) => current.filter((entry) => entry.dedupeKey !== item.dedupeKey));
        setActive(null);
        setNotice({
          text: result.applied
            ? `${result.appliedSummary ?? "Applied to the taxonomy."}${result.changed ? "" : " (already present)"}`
            : "Recorded — thanks for the confirmation.",
        });
      } catch (cause: unknown) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-fg">
            <span className="text-fg-mute">
              <Sparkles size={14} strokeWidth={1.75} />
            </span>
            <h2 className="text-sm font-medium tracking-tight">Review queue</h2>
            <Badge tone={items.length > 0 ? "warning" : "muted"}>{items.length}</Badge>
          </div>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-fg-mute">
            Meetings and messages Strata indexed but couldn't confidently file under a project. Set
            the right project, or confirm none is needed — your call teaches future classification.
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => void load()}
          disabled={busy}
        >
          <RefreshCw size={13} strokeWidth={2} />
          Refresh
        </Button>
      </div>

      {error ? <Callout label="review error">{error}</Callout> : null}
      {notice ? (
        <Callout tone="good" label="reviewed">
          <span className="text-sm text-fg-dim">{notice.text}</span>
        </Callout>
      ) : null}

      <div className="divide-y divide-hairline border-y border-hairline">
        {!loaded ? (
          <ReviewSkeleton />
        ) : items.length === 0 ? (
          <div className="grid justify-items-center gap-2 py-9 text-center">
            <Inbox size={17} strokeWidth={1.75} className="text-fg-mute" />
            <p className="max-w-md text-sm leading-5 text-fg-dim">
              Nothing to review. New meetings or messages we can't file under a project will show up
              here.
            </p>
          </div>
        ) : (
          items.map((item) => (
            <ReviewRow
              key={item.dedupeKey}
              item={item}
              busy={busy}
              expanded={expandedKey === item.dedupeKey}
              onToggle={() =>
                setExpandedKey((current) => (current === item.dedupeKey ? null : item.dedupeKey))
              }
              onConfirm={() => void submit(item, "confirm", emptyFields())}
              onCorrect={() => setActive(item)}
            />
          ))
        )}
      </div>

      <CorrectionDialog
        item={active}
        busy={busy}
        onOpenChange={(open) => {
          if (!open) {
            setActive(null);
          }
        }}
        onSubmit={(verdict, fields) => {
          if (active !== null) {
            void submit(active, verdict, fields);
          }
        }}
      />
    </section>
  );
}

function ReviewRow({
  item,
  busy,
  expanded,
  onToggle,
  onConfirm,
  onCorrect,
}: {
  item: TaxonomyReviewItem;
  busy: boolean;
  expanded: boolean;
  onToggle(): void;
  onConfirm(): void;
  onCorrect(): void;
}): React.ReactElement {
  return (
    <article className="py-3.5">
      <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center lg:gap-4">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          className="group flex min-w-0 items-start gap-2 text-left"
        >
          <ChevronRight
            size={14}
            strokeWidth={2}
            className={cn(
              "mt-0.5 shrink-0 text-fg-mute transition-transform duration-150 group-hover:text-fg-dim",
              expanded && "rotate-90",
            )}
          />
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium text-fg group-hover:text-accent">
              {humanTitle(item)}
            </span>
            <span className="mt-0.5 block truncate text-xs text-fg-mute">{reviewAsk(item)}</span>
          </span>
        </button>
        <div className="flex flex-wrap gap-1.5 lg:justify-end">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={onConfirm}
            className="h-7 px-2 text-xs text-fg-mute hover:text-good"
          >
            <Check size={12} strokeWidth={2} />
            {item.reviewReason === "no_project" ? "No project needed" : "Looks right"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={onCorrect}
            className="h-7 px-2 text-xs"
          >
            {item.reviewReason === "no_project" ? "Set project…" : "Correct…"}
          </Button>
        </div>
      </div>
      {expanded ? <ReviewItemDetail item={item} /> : null}
    </article>
  );
}

/** Loads and shows the raw source text plus exactly what the classifier mapped it to. */
function ReviewItemDetail({ item }: { item: TaxonomyReviewItem }): React.ReactElement {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    setContent(null);
    getWikiPage(item.rawPath.replace(/^wiki\//, ""), true)
      .then((page) => {
        if (alive) setContent(page.content);
      })
      .catch((cause: unknown) => {
        if (alive) setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [item.rawPath]);

  return (
    <div className="mt-3 grid gap-4 rounded-lg border border-hairline bg-bg-elev p-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,15rem)]">
      <div className="min-w-0">
        <Eyebrow>Source · {item.rawPath}</Eyebrow>
        {loading ? (
          <Skeleton className="mt-2 h-48 w-full" />
        ) : error ? (
          <Callout label="couldn't load source">{error}</Callout>
        ) : (
          <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded bg-surface p-3 text-2xs leading-relaxed text-fg-dim">
            {content}
          </pre>
        )}
      </div>
      <div className="min-w-0 space-y-3">
        <DetailField label="Mapped to">
          {item.primaryPath ? (
            <span className="break-words text-fg-dim">{item.primaryPath}</span>
          ) : (
            <span className="text-fg-mute">No wiki page</span>
          )}
        </DetailField>
        <DetailField label="Projects">
          {item.projectPaths.length > 0 ? (
            <ul className="space-y-0.5">
              {item.projectPaths.map((projectPath) => (
                <li key={projectPath} className="break-words text-fg-dim">
                  {prettyName(projectPath)}
                </li>
              ))}
            </ul>
          ) : (
            <span className="text-fg-mute">None — couldn't attribute a project</span>
          )}
        </DetailField>
        {item.reasons.length > 0 ? (
          <DetailField label="Why">
            <ul className="space-y-0.5">
              {item.reasons.map((reason) => (
                <li key={`${reason.kind}:${reason.label}`} className="break-words text-fg-mute">
                  {reason.label}
                  {reason.matchedText ? ` — "${reason.matchedText}"` : ""}
                </li>
              ))}
            </ul>
          </DetailField>
        ) : null}
      </div>
    </div>
  );
}

function DetailField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div>
      <Eyebrow>{label}</Eyebrow>
      <div className="mt-1 text-xs">{children}</div>
    </div>
  );
}

interface CorrectionFields {
  projectLabel: string;
  aliases: string[];
  selfName: string;
  ignorePattern: string;
}

function emptyFields(): CorrectionFields {
  return { projectLabel: "", aliases: [], selfName: "", ignorePattern: "" };
}

function CorrectionDialog({
  item,
  busy,
  onOpenChange,
  onSubmit,
}: {
  item: TaxonomyReviewItem | null;
  busy: boolean;
  onOpenChange(open: boolean): void;
  onSubmit(verdict: Verdict, fields: CorrectionFields): void;
}): React.ReactElement {
  const [verdict, setVerdict] = useState<Verdict>("unrecognized_project");
  const [projectLabel, setProjectLabel] = useState("");
  const [aliasText, setAliasText] = useState("");
  const [selfName, setSelfName] = useState("");
  const [ignorePattern, setIgnorePattern] = useState("");

  useEffect(() => {
    if (item !== null) {
      setVerdict("unrecognized_project");
      setProjectLabel("");
      setAliasText(item.title ?? "");
      setSelfName("");
      setIgnorePattern(item.title ?? "");
    }
  }, [item]);

  const aliases = useMemo(
    () =>
      aliasText
        .split(",")
        .map((value) => value.trim())
        .filter((value) => value.length > 0),
    [aliasText],
  );
  const needs = VERDICTS.find((entry) => entry.value === verdict)?.needs ?? [];
  const canSubmit =
    !busy &&
    (!needs.includes("project") || (projectLabel.trim().length > 0 && aliases.length > 0)) &&
    (!needs.includes("self") || selfName.trim().length > 0) &&
    (!needs.includes("ignore") || ignorePattern.trim().length > 0);

  const selectClass =
    "h-9 w-full rounded-md border border-hairline bg-bg-elev px-2 text-sm text-fg outline-none focus-visible:ring-2 focus-visible:ring-ring";

  return (
    <Dialog open={item !== null} onOpenChange={onOpenChange}>
      <DialogContent className="border-hairline bg-surface">
        <DialogHeader>
          <DialogTitle className="text-base tracking-tight text-fg">
            Correct classification
          </DialogTitle>
          <DialogDescription className="text-sm text-fg-dim">
            {item ? (item.title ?? basename(item.rawPath)) : ""}
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (canSubmit) {
              onSubmit(verdict, {
                projectLabel: projectLabel.trim(),
                aliases,
                selfName: selfName.trim(),
                ignorePattern: ignorePattern.trim(),
              });
            }
          }}
        >
          <label className="grid gap-1.5">
            <Eyebrow>What's wrong?</Eyebrow>
            <select
              value={verdict}
              onChange={(event) => setVerdict(event.target.value as Verdict)}
              className={selectClass}
            >
              {VERDICTS.map((entry) => (
                <option key={entry.value} value={entry.value}>
                  {entry.label}
                </option>
              ))}
            </select>
          </label>

          {needs.includes("project") ? (
            <>
              <label className="grid gap-1.5">
                <Eyebrow>Canonical project</Eyebrow>
                <Input
                  value={projectLabel}
                  onChange={(event) => setProjectLabel(event.target.value)}
                  placeholder="Atlas Portal"
                  className="h-9 border-hairline bg-bg-elev text-sm"
                />
              </label>
              <label className="grid gap-1.5">
                <Eyebrow>Aliases (comma-separated)</Eyebrow>
                <Input
                  value={aliasText}
                  onChange={(event) => setAliasText(event.target.value)}
                  placeholder="atlas, ship"
                  className="h-9 border-hairline bg-bg-elev text-sm"
                />
              </label>
            </>
          ) : null}

          {needs.includes("self") ? (
            <label className="grid gap-1.5">
              <Eyebrow>Your name</Eyebrow>
              <Input
                value={selfName}
                onChange={(event) => setSelfName(event.target.value)}
                placeholder="Sam Rivera"
                className="h-9 border-hairline bg-bg-elev text-sm"
              />
            </label>
          ) : null}

          {needs.includes("ignore") ? (
            <label className="grid gap-1.5">
              <Eyebrow>Phrase to ignore</Eyebrow>
              <Input
                value={ignorePattern}
                onChange={(event) => setIgnorePattern(event.target.value)}
                placeholder="deploy succeeded"
                className="h-9 border-hairline bg-bg-elev font-mono text-sm"
              />
            </label>
          ) : null}

          <DialogFooter className="gap-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              className="text-fg-mute hover:text-fg"
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={!canSubmit}>
              {verdict === "confirm" ? "Record" : "Stage fix"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ReviewSkeleton(): React.ReactElement {
  return (
    <>
      {Array.from({ length: 3 }, (_, index) => (
        <div key={index} className="flex items-center justify-between gap-3 py-3">
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-4 w-56 max-w-full" />
            <Skeleton className="h-3 w-40" />
          </div>
          <Skeleton className="h-7 w-28" />
        </div>
      ))}
    </>
  );
}

function basename(value: string): string {
  const parts = value.replace(/:\d+$/, "").split("/");
  return parts[parts.length - 1] ?? value;
}

function titleCase(value: string): string {
  return value.length === 0 ? value : `${value[0]?.toUpperCase()}${value.slice(1)}`;
}

/** Turn a kebab/date-prefixed filename into a readable label. */
function prettyName(pathLike: string): string {
  const base = basename(pathLike)
    .replace(/\.md$/, "")
    .replace(/^\d{4}-\d{2}-\d{2}-/, "");
  const words = base.replace(/[-_]+/g, " ").trim();
  return words.length === 0 ? base : titleCase(words);
}

/** The human-facing name of the reviewed source — its title, or a cleaned filename. */
function humanTitle(item: TaxonomyReviewItem): string {
  const title = item.title?.trim();
  return title && title.length > 0 ? title : prettyName(item.primaryPath ?? item.rawPath);
}

function itemKind(item: TaxonomyReviewItem): string {
  const where = item.primaryPath ?? item.rawPath;
  if (where.includes("/meetings/")) return "meeting";
  if (where.includes("/people/")) return "person";
  if (where.includes("/projects/")) return "project";
  if (where.includes("/decisions/")) return "decision";
  if (where.includes("/threads/")) return "thread";
  if (where.includes("/slack/") || where.includes("/sources/")) return "message";
  return "note";
}

/** A plain-language description of why this outcome needs a verdict. */
function reviewAsk(item: TaxonomyReviewItem): string {
  const label = `${titleCase(item.source)} ${itemKind(item)}`;
  if (item.reviewReason === "no_project") {
    return `${label} · we couldn't link it to a project`;
  }
  const guessed = item.projectPaths[0] ? prettyName(item.projectPaths[0]) : "a project";
  return `${label} · auto-linked to ${guessed}`;
}
