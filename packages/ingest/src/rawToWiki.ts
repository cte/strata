import { existsSync } from "node:fs";
import { mkdir, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import {
  type LearningProposalRecord,
  readTextFileOrUndefined,
  SessionStore,
  writeLearningProposal,
  writeTextFile,
} from "@strata/core";
import { frontmatter, slugify, splitFrontmatter, utcNow } from "./common.js";

export interface GranolaRawToWikiOptions {
  repoRoot: string;
  rawPaths?: string[];
  limit?: number;
  now?: Date;
}

export interface GranolaRawMeetingProposal {
  rawPath: string;
  title: string;
  date: string;
  sourceUrl: string | null;
  attendees: string[];
  proposedMeetingPath: string;
  peopleCandidates: string[];
  projectCandidates: string[];
  actionCandidates: CandidateLine[];
  decisionCandidates: CandidateLine[];
  uncertainty: string[];
  proposalPath: string;
}

export interface CandidateLine {
  line: number;
  text: string;
}

export interface GranolaRawToWikiSkip {
  rawPath: string;
  reason: string;
}

export interface GranolaRawToWikiResult {
  sessionId: string;
  scanned: number;
  proposals: LearningProposalRecord[];
  items: GranolaRawMeetingProposal[];
  skipped: GranolaRawToWikiSkip[];
}

export interface GranolaRawToWikiIndexOptions {
  repoRoot: string;
  rawPaths?: string[];
  limit?: number;
  dryRun?: boolean;
  now?: Date;
}

export interface GranolaWikiIndexItem {
  rawPath: string;
  meetingPath: string;
  title: string;
  date: string;
  peoplePaths: string[];
  projectPaths: string[];
  decisionPaths: string[];
  threadPaths: string[];
  actionCount: number;
  writtenPaths: string[];
}

export interface GranolaRawToWikiIndexResult {
  sessionId: string;
  dryRun: boolean;
  scanned: number;
  indexed: GranolaWikiIndexItem[];
  skipped: GranolaRawToWikiSkip[];
}

export type RawToWikiSource = "granola" | "notion" | "slack";
export type RawToWikiSourceFilter = RawToWikiSource | "all";

export interface RawToWikiIndexOptions {
  repoRoot: string;
  source?: RawToWikiSourceFilter;
  rawPaths?: string[];
  limit?: number;
  dryRun?: boolean;
  now?: Date;
}

export interface RawToWikiIndexItem {
  source: RawToWikiSource;
  rawPath: string;
  primaryKind: "meeting" | "project" | "thread";
  primaryPath: string;
  title: string;
  date: string;
  peoplePaths: string[];
  projectPaths: string[];
  decisionPaths: string[];
  threadPaths: string[];
  actionCount: number;
  writtenPaths: string[];
}

export interface RawToWikiIndexResult {
  sessionId: string;
  dryRun: boolean;
  scanned: number;
  indexed: RawToWikiIndexItem[];
  skipped: GranolaRawToWikiSkip[];
}

interface RawMeetingDraft {
  rawPath: string;
  title: string;
  date: string;
  sourceUrl: string | null;
  attendees: string[];
  body: string;
  proposedMeetingPath: string;
  peopleCandidates: string[];
  projectCandidates: string[];
  actionCandidates: CandidateLine[];
  decisionCandidates: CandidateLine[];
  uncertainty: string[];
}

interface ProjectCandidate {
  label: string;
  path: string;
}

interface EntityCandidate {
  title: string;
  text: string;
  path: string;
  line?: number;
}

interface ActionCandidate {
  text: string;
  owner: "mine" | "theirs";
  line?: number;
}

interface SourceWikiDraft {
  source: Exclude<RawToWikiSource, "granola">;
  rawPath: string;
  title: string;
  date: string;
  sourceUrl: string | null;
  body: string;
  summary: string;
  primaryKind: "project" | "thread";
  primaryPath: string;
  peopleCandidates: string[];
  projectCandidates: string[];
  actionCandidates: CandidateLine[];
  decisionCandidates: CandidateLine[];
  threadCandidates: CandidateLine[];
  metadata: RawFrontmatter;
}

interface SkippedRawSourceDraft {
  skipped: true;
  rawPath: string;
  reason: string;
}

interface SourceClassified {
  people: { label: string; path: string }[];
  projects: ProjectCandidate[];
  decisions: EntityCandidate[];
  threads: EntityCandidate[];
  actions: ActionCandidate[];
}

interface SourceWikiApplyPlan {
  draft: SourceWikiDraft;
  classified: SourceClassified;
  primaryContent: string;
  writtenPaths: string[];
}

interface ClassifiedMeeting {
  people: { label: string; path: string }[];
  projects: ProjectCandidate[];
  decisions: EntityCandidate[];
  threads: EntityCandidate[];
  actions: ActionCandidate[];
}

interface GranolaWikiApplyPlan {
  draft: RawMeetingDraft;
  classified: ClassifiedMeeting;
  meetingContent: string;
  writtenPaths: string[];
}

interface RawFrontmatter {
  scalars: Record<string, string>;
  arrays: Record<string, string[]>;
}

const ACTION_PATTERNS = [
  /^\s*[-*]\s+\[[ x]\]\s+/i,
  /\b(action item|todo|follow[- ]?up|next step|owner:|due:)\b/i,
  /\b(I|we|they|[A-Z][a-z]+)\s+(will|should|need to|needs to|must)\b/,
];

const DECISION_PATTERNS = [
  /\b(decision|decided|agreed|approved|greenlit|settled)\b/i,
  /\b(we will|we're going to|going forward|the plan is)\b/i,
];

const SLACK_MATERIAL_PATTERNS = [
  /\?/,
  /\b(can you|could you|please|i'd like|i would like|i want|we need|need help|let's|lets)\b/i,
  /\b(add|remove|update|migrate|fix|debug|investigate|look at|take a look|make)\b/i,
  /\b(what happened|why|how do|should we|do we know|is it possible|question)\b/i,
  /\b(decision|agreed|decided|approved|we will|going forward|the plan is)\b/i,
  /\b(customer|support issue|linear issue|severity|root cause|incident|pricing|launch|onboarding|self serve)\b/i,
  /\b(task|pull request|pr|feature flag|billing|trial|quota|token|cost|modal|vercel|sandbox|sentry|security|bug|error|slack app|deploy marker)\b/i,
  /\$handle-[a-z-]+/i,
];

const SLACK_LOW_SIGNAL_PATTERNS = [
  /^\[?roomote-(worker|dispatcher)\]?/i,
  /^\[?roomote\]?\s+error\b/i,
  /^roomote (worker|dispatcher|error)\b/i,
  /\bcodex-acp:stderr\b/i,
  /\btrpcclienterror\b/i,
  /\bquota exceeded\b/i,
  /^router-slack\b/i,
  /^\*?(codepush|deploy(?:[- ][a-z0-9]+)*)\*?.*\bstarting\b/i,
  /^\*?(codepush|deploy(?:[- ][a-z0-9]+)*)\*?.*\bsuccess\b/i,
  /^release merged to\s+[`'"]?main[`'"]?\b/i,
  /^published\b.+\bsuccessfully to npm\b/i,
  /\b(detached worker run exited|error level error is not supported)\b/i,
  /\b(status\.[a-z0-9.-]+|githubstatus\.com|vercel-status\.com)\b/i,
  /(?:\bbell\b|:bell:)\s*[: -]?\s*(unsuccessful|new user|new waitlist|platform issue|prompt requests|alternative software|yesterday)/i,
  /\bnew support ticket\b/i,
  /\bhandshake-new-linkedin-connection-accepted-prospect\b/i,
  /\broomote e2e (failed|passed)\b/i,
  /\bweekly stats\b/i,
];

export async function runGranolaRawToWikiProposals(
  options: GranolaRawToWikiOptions,
): Promise<GranolaRawToWikiResult> {
  const repoRoot = path.resolve(options.repoRoot);
  const rawPaths = await resolveGranolaRawPaths(repoRoot, options);
  const store = await SessionStore.open(repoRoot);
  const session = await store.createSession({
    kind: "ingest",
    title: `Propose wiki updates from ${rawPaths.length} Granola raw file${
      rawPaths.length === 1 ? "" : "s"
    }`,
  });
  try {
    await store.appendEvent(session.id, "raw_to_wiki.granola.started", {
      rawPaths,
      limit: options.limit ?? null,
    });

    const proposals: LearningProposalRecord[] = [];
    const items: GranolaRawMeetingProposal[] = [];
    const skipped: GranolaRawToWikiSkip[] = [];

    for (const rawPath of rawPaths) {
      const absoluteRawPath = path.resolve(repoRoot, rawPath);
      const relativeRawPath = path.relative(repoRoot, absoluteRawPath);
      const text = await readFile(absoluteRawPath, "utf8");
      const draft = buildGranolaMeetingDraft(repoRoot, relativeRawPath, text);
      if (draft === null) {
        skipped.push({
          rawPath: relativeRawPath,
          reason: "Raw file is not a Granola transcript snapshot.",
        });
        continue;
      }
      if (existsSync(path.join(repoRoot, draft.proposedMeetingPath))) {
        skipped.push({
          rawPath: relativeRawPath,
          reason: `Meeting page already exists at ${draft.proposedMeetingPath}.`,
        });
        continue;
      }

      const proposal = await writeLearningProposal(repoRoot, {
        kind: "wiki",
        sessionId: session.id,
        title: `Create meeting page for ${draft.date} ${draft.title}`,
        reason:
          "Granola raw snapshots are immutable source material. This stages the first wiki meeting page and related extraction candidates for human review before any wiki pages are edited.",
        evidence: proposalEvidence(draft),
        proposedChange: formatProposedChange(draft),
        risk: "Medium. The source transcript may omit speaker identity or context, so project links, decisions, and action ownership need manual review before applying.",
      });
      await store.appendEvent(session.id, "proposal.created", proposal);
      proposals.push(proposal);
      items.push({
        rawPath: draft.rawPath,
        title: draft.title,
        date: draft.date,
        sourceUrl: draft.sourceUrl,
        attendees: draft.attendees,
        proposedMeetingPath: draft.proposedMeetingPath,
        peopleCandidates: draft.peopleCandidates,
        projectCandidates: draft.projectCandidates,
        actionCandidates: draft.actionCandidates,
        decisionCandidates: draft.decisionCandidates,
        uncertainty: draft.uncertainty,
        proposalPath: proposal.path,
      });
    }

    await store.appendEvent(session.id, "raw_to_wiki.granola.completed", {
      scanned: rawPaths.length,
      proposalCount: proposals.length,
      skipped: skipped.map((item) => ({ rawPath: item.rawPath, reason: item.reason })),
    });
    await store.endSession(session.id, "completed");
    return {
      sessionId: session.id,
      scanned: rawPaths.length,
      proposals,
      items,
      skipped,
    };
  } catch (error) {
    await store.appendEvent(session.id, "raw_to_wiki.granola.failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    await store.endSession(session.id, "failed");
    throw error;
  } finally {
    store.close();
  }
}

export async function runGranolaRawToWikiIndex(
  options: GranolaRawToWikiIndexOptions,
): Promise<GranolaRawToWikiIndexResult> {
  const result = await runRawToWikiIndex({ ...options, source: "granola" });
  return {
    sessionId: result.sessionId,
    dryRun: result.dryRun,
    scanned: result.scanned,
    indexed: result.indexed.map((item) => ({
      rawPath: item.rawPath,
      meetingPath: item.primaryPath,
      title: item.title,
      date: item.date,
      peoplePaths: item.peoplePaths,
      projectPaths: item.projectPaths,
      decisionPaths: item.decisionPaths,
      threadPaths: item.threadPaths,
      actionCount: item.actionCount,
      writtenPaths: item.writtenPaths,
    })),
    skipped: result.skipped,
  };
}

export async function runRawToWikiIndex(
  options: RawToWikiIndexOptions,
): Promise<RawToWikiIndexResult> {
  const repoRoot = path.resolve(options.repoRoot);
  const rawPaths = await resolveRawToWikiPaths(repoRoot, options);
  const dryRun = options.dryRun ?? false;
  const now = options.now ?? utcNow();
  const sourceLabel = options.source ?? "all";
  const store = await SessionStore.open(repoRoot);
  const session = await store.createSession({
    kind: "ingest",
    title: `${dryRun ? "Preview" : "Index"} ${rawPaths.length} ${sourceLabel} raw file${
      rawPaths.length === 1 ? "" : "s"
    }`,
  });
  try {
    await store.appendEvent(session.id, "raw_to_wiki.index.started", {
      rawPaths,
      dryRun,
      limit: options.limit ?? null,
      source: sourceLabel,
    });

    const indexed: RawToWikiIndexItem[] = [];
    const skipped: GranolaRawToWikiSkip[] = [];

    for (const rawPath of rawPaths) {
      const absoluteRawPath = path.resolve(repoRoot, rawPath);
      const relativeRawPath = path.relative(repoRoot, absoluteRawPath);
      const text = await readFile(absoluteRawPath, "utf8");
      const draft = buildRawSourceDraft(repoRoot, relativeRawPath, text);
      if (draft === null) {
        skipped.push({
          rawPath: relativeRawPath,
          reason: "Raw file is not a supported Strata raw source snapshot.",
        });
        continue;
      }
      if (isSkippedRawSourceDraft(draft)) {
        skipped.push({
          rawPath: draft.rawPath,
          reason: draft.reason,
        });
        continue;
      }
      if (await sourceDraftAlreadyIndexed(repoRoot, draft)) {
        skipped.push({
          rawPath: relativeRawPath,
          reason: `Source already indexed at ${primaryPathForDraft(draft)}.`,
        });
        continue;
      }

      const plan = buildSourceApplyPlan(repoRoot, draft, now);
      const writtenPaths = dryRun ? plan.writtenPaths : await applySourceWikiPlan(repoRoot, plan);
      const item = rawToWikiIndexItem(plan, writtenPaths);
      indexed.push(item);
      await store.appendEvent(session.id, "raw_to_wiki.index.item", {
        source: item.source,
        rawPath: item.rawPath,
        primaryKind: item.primaryKind,
        primaryPath: item.primaryPath,
        writtenPaths: item.writtenPaths,
        dryRun,
      });
    }

    if (!dryRun && indexed.length > 0) {
      const logPath = await appendWikiLog(
        repoRoot,
        now,
        "ingest",
        `Raw-to-wiki indexed ${indexed.length} source${indexed.length === 1 ? "" : "s"}`,
      );
      await store.appendEvent(session.id, "raw_to_wiki.index.log", { path: logPath });
    }

    await store.appendEvent(session.id, "raw_to_wiki.index.completed", {
      scanned: rawPaths.length,
      indexedCount: indexed.length,
      skipped: skipped.map((item) => ({ rawPath: item.rawPath, reason: item.reason })),
      dryRun,
      source: sourceLabel,
    });
    await store.endSession(session.id, "completed");
    return {
      sessionId: session.id,
      dryRun,
      scanned: rawPaths.length,
      indexed,
      skipped,
    };
  } catch (error) {
    await store.appendEvent(session.id, "raw_to_wiki.index.failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    await store.endSession(session.id, "failed");
    throw error;
  } finally {
    store.close();
  }
}

export function buildGranolaMeetingDraft(
  repoRoot: string,
  rawPath: string,
  text: string,
): RawMeetingDraft | null {
  const parsed = parseRawFrontmatter(text);
  const type = parsed.scalars.type ?? "";
  const source = parsed.scalars.source ?? "";
  if (type !== "raw_granola_transcript" && source !== "granola") {
    return null;
  }

  const split = splitFrontmatter(text);
  const body = stripLeadingTitle(split.body);
  const title = parsed.scalars.title || firstHeading(split.body) || "Untitled meeting";
  const date =
    normalizeDate(parsed.scalars.date) ??
    dateFromRawPath(rawPath) ??
    utcNow().toISOString().slice(0, 10);
  const attendees = uniqueStrings(parsed.arrays.attendees ?? []);
  const proposedMeetingPath = path.join(
    "wiki",
    "meetings",
    `${date}-${slugify(title, "meeting")}.md`,
  );
  const actionCandidates = candidateLines(body, ACTION_PATTERNS, 12);
  const decisionCandidates = candidateLines(body, DECISION_PATTERNS, 12);
  const projectCandidates = projectCandidatesFrom(parsed);
  const peopleCandidates = uniqueStrings([...attendees, ...speakerCandidates(body)]).slice(0, 24);

  return {
    rawPath,
    title,
    date,
    sourceUrl: parsed.scalars.source_url || null,
    attendees,
    body,
    proposedMeetingPath,
    peopleCandidates,
    projectCandidates,
    actionCandidates,
    decisionCandidates,
    uncertainty: uncertaintyFor({
      attendees,
      projectCandidates,
      actionCandidates,
      decisionCandidates,
      body,
      repoRoot,
      proposedMeetingPath,
    }),
  };
}

function buildGranolaWikiApplyPlan(
  repoRoot: string,
  draft: RawMeetingDraft,
  now: Date,
): GranolaWikiApplyPlan {
  const classified = classifyGranolaMeeting(draft);
  const meetingContent = formatMeetingPage(draft, classified, now);
  const writtenPaths = uniqueStrings([
    draft.proposedMeetingPath,
    ...classified.people.map((item) => item.path),
    ...classified.projects.map((item) => item.path),
    ...classified.decisions.map((item) => item.path),
    ...classified.threads.map((item) => item.path),
    "wiki/actions/mine.md",
    "wiki/actions/theirs.md",
    "wiki/index.md",
    "wiki/log.md",
  ]);
  return { draft, classified, meetingContent, writtenPaths };
}

async function applyGranolaWikiPlan(
  repoRoot: string,
  plan: GranolaWikiApplyPlan,
): Promise<string[]> {
  const written = new Set<string>();
  await writeWikiFile(repoRoot, plan.draft.proposedMeetingPath, plan.meetingContent);
  written.add(plan.draft.proposedMeetingPath);

  for (const person of plan.classified.people) {
    if (await upsertPersonPage(repoRoot, person, plan)) {
      written.add(person.path);
    }
  }
  for (const project of plan.classified.projects) {
    if (await upsertProjectPage(repoRoot, project, plan)) {
      written.add(project.path);
    }
  }
  for (const decision of plan.classified.decisions) {
    if (await upsertDecisionPage(repoRoot, decision, plan)) {
      written.add(decision.path);
    }
  }
  for (const thread of plan.classified.threads) {
    if (await upsertThreadPage(repoRoot, thread, plan)) {
      written.add(thread.path);
    }
  }
  if (await appendActions(repoRoot, "mine", plan)) {
    written.add("wiki/actions/mine.md");
  }
  if (await appendActions(repoRoot, "theirs", plan)) {
    written.add("wiki/actions/theirs.md");
  }
  if (await updateWikiIndex(repoRoot, plan)) {
    written.add("wiki/index.md");
  }
  return [...written];
}

function granolaWikiIndexItem(
  plan: GranolaWikiApplyPlan,
  writtenPaths: string[],
): GranolaWikiIndexItem {
  return {
    rawPath: plan.draft.rawPath,
    meetingPath: plan.draft.proposedMeetingPath,
    title: plan.draft.title,
    date: plan.draft.date,
    peoplePaths: plan.classified.people.map((item) => item.path),
    projectPaths: plan.classified.projects.map((item) => item.path),
    decisionPaths: plan.classified.decisions.map((item) => item.path),
    threadPaths: plan.classified.threads.map((item) => item.path),
    actionCount: plan.classified.actions.length,
    writtenPaths,
  };
}

function buildRawSourceDraft(
  repoRoot: string,
  rawPath: string,
  text: string,
): RawMeetingDraft | SourceWikiDraft | SkippedRawSourceDraft | null {
  const parsed = parseRawFrontmatter(text);
  const source = sourceFromRaw(rawPath, parsed);
  if (source === "granola") {
    return buildGranolaMeetingDraft(repoRoot, rawPath, text);
  }
  if (source === "notion") {
    return buildNotionSourceDraft(rawPath, text, parsed);
  }
  if (source === "slack") {
    return buildSlackSourceDraft(rawPath, text, parsed);
  }
  return null;
}

function sourceFromRaw(rawPath: string, parsed: RawFrontmatter): RawToWikiSource | null {
  const source = parsed.scalars.source?.toLowerCase();
  const type = parsed.scalars.type?.toLowerCase();
  if (source === "granola" || type === "raw_granola_transcript") {
    return "granola";
  }
  if (source === "notion" || type === "raw_notion_page") {
    return "notion";
  }
  if (source === "slack" || type === "raw_slack_thread") {
    return "slack";
  }
  if (rawPath.includes(`${path.sep}raw${path.sep}granola${path.sep}`)) {
    return "granola";
  }
  if (rawPath.includes(`${path.sep}raw${path.sep}notion${path.sep}`)) {
    return "notion";
  }
  if (rawPath.includes(`${path.sep}raw${path.sep}slack${path.sep}`)) {
    return "slack";
  }
  return null;
}

function buildNotionSourceDraft(
  rawPath: string,
  text: string,
  parsed: RawFrontmatter,
): SourceWikiDraft | null {
  if (parsed.scalars.type !== "raw_notion_page" && parsed.scalars.source !== "notion") {
    return null;
  }
  const split = splitFrontmatter(text);
  const body = stripLeadingTitle(split.body);
  const title = parsed.scalars.title || firstHeading(split.body) || "Untitled Notion page";
  const date =
    normalizeDate(parsed.scalars.date) ??
    dateFromRawPath(rawPath) ??
    utcNow().toISOString().slice(0, 10);
  const summary = sourceSummary(body);
  const primaryLabel = cleanProjectLabel(title);
  const projectCandidates = uniqueStrings([
    primaryLabel,
    ...projectCandidatesFrom(parsed),
    ...projectLabelsFromTitleAndBody(title, body),
  ]).slice(0, 8);
  return {
    source: "notion",
    rawPath,
    title,
    date,
    sourceUrl: parsed.scalars.source_url || null,
    body,
    summary,
    primaryKind: "project",
    primaryPath: path.join("wiki", "projects", `${slugify(primaryLabel, "notion-page")}.md`),
    peopleCandidates: peopleCandidatesForSource(body, parsed).slice(0, 16),
    projectCandidates,
    actionCandidates: candidateLines(summary, ACTION_PATTERNS, 8),
    decisionCandidates: candidateLines(summary, DECISION_PATTERNS, 8),
    threadCandidates: threadCandidatesForSource(summary, 8),
    metadata: parsed,
  };
}

function buildSlackSourceDraft(
  rawPath: string,
  text: string,
  parsed: RawFrontmatter,
): SourceWikiDraft | SkippedRawSourceDraft | null {
  if (parsed.scalars.type !== "raw_slack_thread" && parsed.scalars.source !== "slack") {
    return null;
  }
  const split = splitFrontmatter(text);
  const body = stripLeadingTitle(split.body);
  const title = parsed.scalars.title || firstHeading(split.body) || "Slack thread";
  const messages = slackMessageTexts(body);
  const materiality = slackMateriality({ body, messages, parsed, title });
  if (!materiality.material) {
    return {
      skipped: true,
      rawPath,
      reason: materiality.reason,
    };
  }
  const date =
    normalizeDate(parsed.scalars.date) ??
    dateFromRawPath(rawPath) ??
    utcNow().toISOString().slice(0, 10);
  const summary = slackSummary(messages, title);
  const channel = parsed.scalars.channel || "slack";
  const threadTs = parsed.scalars.thread_ts || slugify(title, "thread");
  const primarySlug = `${slugify(channel)}-${slackTsSlug(threadTs)}-${slugify(title, "thread")}`;
  return {
    source: "slack",
    rawPath,
    title,
    date,
    sourceUrl: parsed.scalars.source_url || null,
    body,
    summary,
    primaryKind: "thread",
    primaryPath: path.join("wiki", "threads", `${primarySlug}.md`),
    peopleCandidates: slackParticipantsFromHeadings(body).slice(0, 16),
    projectCandidates: slackProjectLabelsFromTitleAndBody(title, body).slice(0, 8),
    actionCandidates: candidateLines(summary, ACTION_PATTERNS, 8),
    decisionCandidates: candidateLines(summary, DECISION_PATTERNS, 8),
    threadCandidates: threadCandidatesForSource(summary, 6),
    metadata: parsed,
  };
}

function isSkippedRawSourceDraft(value: unknown): value is SkippedRawSourceDraft {
  return typeof value === "object" && value !== null && (value as SkippedRawSourceDraft).skipped;
}

async function sourceDraftAlreadyIndexed(
  repoRoot: string,
  draft: RawMeetingDraft | SourceWikiDraft,
): Promise<boolean> {
  const primaryPath = primaryPathForDraft(draft);
  const existing = await readWikiFile(repoRoot, primaryPath);
  return existing !== undefined && existing.includes(draft.rawPath.replace(/^wiki\//, ""));
}

function primaryPathForDraft(draft: RawMeetingDraft | SourceWikiDraft): string {
  return "proposedMeetingPath" in draft ? draft.proposedMeetingPath : draft.primaryPath;
}

function buildSourceApplyPlan(
  repoRoot: string,
  draft: RawMeetingDraft | SourceWikiDraft,
  now: Date,
): GranolaWikiApplyPlan | SourceWikiApplyPlan {
  if ("proposedMeetingPath" in draft) {
    return buildGranolaWikiApplyPlan(repoRoot, draft, now);
  }
  const classified = classifySourceDraft(draft);
  const primaryContent = formatSourcePrimaryPage(draft, classified, now);
  const writtenPaths = uniqueStrings([
    draft.primaryPath,
    ...classified.people.map((item) => item.path),
    ...classified.projects.map((item) => item.path),
    ...classified.decisions.map((item) => item.path),
    ...classified.threads.map((item) => item.path),
    "wiki/actions/mine.md",
    "wiki/actions/theirs.md",
    "wiki/index.md",
    "wiki/log.md",
  ]);
  return { draft, classified, primaryContent, writtenPaths };
}

async function applySourceWikiPlan(
  repoRoot: string,
  plan: GranolaWikiApplyPlan | SourceWikiApplyPlan,
): Promise<string[]> {
  if ("meetingContent" in plan) {
    return applyGranolaWikiPlan(repoRoot, plan);
  }
  const written = new Set<string>();
  if (await upsertSourcePrimaryPage(repoRoot, plan)) {
    written.add(plan.draft.primaryPath);
  }
  for (const person of plan.classified.people) {
    if (await upsertSourcePersonPage(repoRoot, person, plan)) {
      written.add(person.path);
    }
  }
  for (const project of plan.classified.projects) {
    if (await upsertSourceProjectPage(repoRoot, project, plan)) {
      written.add(project.path);
    }
  }
  for (const decision of plan.classified.decisions) {
    if (await upsertSourceDecisionPage(repoRoot, decision, plan)) {
      written.add(decision.path);
    }
  }
  for (const thread of plan.classified.threads) {
    if (await upsertSourceThreadPage(repoRoot, thread, plan)) {
      written.add(thread.path);
    }
  }
  if (await appendSourceActions(repoRoot, "mine", plan)) {
    written.add("wiki/actions/mine.md");
  }
  if (await appendSourceActions(repoRoot, "theirs", plan)) {
    written.add("wiki/actions/theirs.md");
  }
  if (await updateSourceWikiIndex(repoRoot, plan)) {
    written.add("wiki/index.md");
  }
  return [...written];
}

function rawToWikiIndexItem(
  plan: GranolaWikiApplyPlan | SourceWikiApplyPlan,
  writtenPaths: string[],
): RawToWikiIndexItem {
  if ("meetingContent" in plan) {
    const item = granolaWikiIndexItem(plan, writtenPaths);
    return {
      source: "granola",
      rawPath: item.rawPath,
      primaryKind: "meeting",
      primaryPath: item.meetingPath,
      title: item.title,
      date: item.date,
      peoplePaths: item.peoplePaths,
      projectPaths: item.projectPaths,
      decisionPaths: item.decisionPaths,
      threadPaths: item.threadPaths,
      actionCount: item.actionCount,
      writtenPaths,
    };
  }
  return {
    source: plan.draft.source,
    rawPath: plan.draft.rawPath,
    primaryKind: plan.draft.primaryKind,
    primaryPath: plan.draft.primaryPath,
    title: plan.draft.title,
    date: plan.draft.date,
    peoplePaths: plan.classified.people.map((item) => item.path),
    projectPaths: plan.classified.projects.map((item) => item.path),
    decisionPaths: plan.classified.decisions.map((item) => item.path),
    threadPaths: uniqueStrings([
      plan.draft.primaryKind === "thread" ? plan.draft.primaryPath : "",
      ...plan.classified.threads.map((item) => item.path),
    ]).filter((item) => item !== ""),
    actionCount: plan.classified.actions.length,
    writtenPaths,
  };
}

function classifyGranolaMeeting(draft: RawMeetingDraft): ClassifiedMeeting {
  const summary = meetingSummary(draft);
  const summaryActionCandidates = candidateLines(summary, ACTION_PATTERNS, 8);
  const summaryDecisionCandidates = candidateLines(summary, DECISION_PATTERNS, 6);
  const people = draft.peopleCandidates.map((name) => ({
    label: name,
    path: path.join("wiki", "people", `${slugify(name, "person")}.md`),
  }));
  const projects = projectCandidatesForMeeting(draft).map((label) => ({
    label,
    path: path.join("wiki", "projects", `${slugify(label, "project")}.md`),
  }));
  const decisions = summaryDecisionCandidates.map((candidate) => {
    const title = sentenceTitle(candidate.text);
    return {
      title,
      text: candidate.text,
      path: path.join("wiki", "decisions", `${draft.date}-${slugify(title, "decision")}.md`),
      line: candidate.line,
    };
  });
  const threads = threadCandidatesForMeeting(draft, summary).map((candidate) => {
    const title = sentenceTitle(candidate.text);
    return {
      title,
      text: candidate.text,
      path: path.join("wiki", "threads", `${slugify(title, "thread")}.md`),
      line: candidate.line,
    };
  });
  const actions = summaryActionCandidates.map((candidate) => ({
    text: candidate.text,
    owner: actionOwner(candidate.text),
    line: candidate.line,
  }));
  return {
    people: dedupeByPath(people),
    projects: dedupeByPath(projects).slice(0, 6),
    decisions: dedupeByPath(decisions),
    threads: dedupeByPath(threads).slice(0, 6),
    actions,
  };
}

function classifySourceDraft(draft: SourceWikiDraft): SourceClassified {
  const people = draft.peopleCandidates.map((name) => ({
    label: name,
    path: path.join("wiki", "people", `${slugify(name, "person")}.md`),
  }));
  const projects = draft.projectCandidates.map((label) => ({
    label,
    path: path.join("wiki", "projects", `${slugify(label, "project")}.md`),
  }));
  const decisions = draft.decisionCandidates.map((candidate) => {
    const title = sentenceTitle(candidate.text);
    return {
      title,
      text: candidate.text,
      path: path.join("wiki", "decisions", `${draft.date}-${slugify(title, "decision")}.md`),
      line: candidate.line,
    };
  });
  const threads = draft.threadCandidates.map((candidate) => {
    const title = sentenceTitle(candidate.text);
    return {
      title,
      text: candidate.text,
      path: path.join("wiki", "threads", `${slugify(title, "thread")}.md`),
      line: candidate.line,
    };
  });
  const actions = draft.actionCandidates.map((candidate) => ({
    text: candidate.text,
    owner: actionOwner(candidate.text),
    line: candidate.line,
  }));
  return {
    people: dedupeByPath(people),
    projects: dedupeByPath(projects).slice(0, 6),
    decisions: dedupeByPath(decisions).slice(0, 6),
    threads: dedupeByPath(threads).slice(0, 6),
    actions,
  };
}

function formatMeetingPage(
  draft: RawMeetingDraft,
  classified: ClassifiedMeeting,
  now: Date,
): string {
  const summary = meetingSummary(draft);
  const sourceLines = [
    `- Raw transcript: [${draft.rawPath.replace(/^wiki\//, "")}](${relativeSourceLink(draft.rawPath)})`,
  ];
  if (draft.sourceUrl) {
    sourceLines.push(`- Granola: ${draft.sourceUrl}`);
  }
  return [
    frontmatter({
      type: "meeting",
      date: draft.date,
      title: draft.title,
      source: draft.rawPath.replace(/^wiki\//, ""),
      attendees: classified.people.map((item) => item.label),
      projects: classified.projects.map((item) => item.label),
      indexed_at: now.toISOString(),
    }).trimEnd(),
    "",
    `# ${draft.title}`,
    "",
    "## Summary",
    "",
    summary,
    "",
    "## People",
    "",
    formatEntityLinks(classified.people),
    "",
    "## Projects",
    "",
    formatEntityLinks(classified.projects),
    "",
    "## Decisions",
    "",
    formatEntityLinks(classified.decisions),
    "",
    "## Actions",
    "",
    formatActionBullets(classified.actions),
    "",
    "## Threads",
    "",
    formatEntityLinks(classified.threads),
    "",
    "## Source",
    "",
    ...sourceLines,
    "",
  ].join("\n");
}

async function resolveGranolaRawPaths(
  repoRoot: string,
  options: GranolaRawToWikiOptions,
): Promise<string[]> {
  const explicit = options.rawPaths ?? [];
  if (explicit.length > 0) {
    return explicit
      .map((item) => normalizeExplicitRawPath(repoRoot, item))
      .slice(0, options.limit ?? explicit.length);
  }
  const rawDir = path.join(repoRoot, "wiki", "raw", "granola");
  await mkdir(rawDir, { recursive: true });
  const entries = await readdir(rawDir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md") && !entry.name.startsWith("."))
    .map((entry) => path.join("wiki", "raw", "granola", entry.name))
    .sort();
  return files.slice(0, options.limit ?? files.length);
}

async function resolveRawToWikiPaths(
  repoRoot: string,
  options: RawToWikiIndexOptions,
): Promise<string[]> {
  const explicit = options.rawPaths ?? [];
  const sources = sourcesForFilter(options.source ?? "all");
  if (explicit.length > 0) {
    return explicit
      .map((item) => normalizeExplicitAnyRawPath(repoRoot, item, sources))
      .slice(0, options.limit ?? explicit.length);
  }

  const paths: string[] = [];
  for (const source of sources) {
    const rawDir = path.join(repoRoot, "wiki", "raw", source);
    await mkdir(rawDir, { recursive: true });
    const entries = await readdir(rawDir, { withFileTypes: true });
    paths.push(
      ...entries
        .filter(
          (entry) => entry.isFile() && entry.name.endsWith(".md") && !entry.name.startsWith("."),
        )
        .map((entry) => path.join("wiki", "raw", source, entry.name)),
    );
  }
  const deduped = await dedupeRawSourcePaths(repoRoot, paths.sort());
  return deduped.slice(0, options.limit ?? deduped.length);
}

function sourcesForFilter(filter: RawToWikiSourceFilter): RawToWikiSource[] {
  return filter === "all" ? ["granola", "notion", "slack"] : [filter];
}

function normalizeExplicitRawPath(repoRoot: string, rawPath: string): string {
  const absolute = path.resolve(repoRoot, rawPath);
  const relative = path.relative(repoRoot, absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Granola raw path must be inside the repo: ${rawPath}`);
  }
  if (!relative.startsWith(path.join("wiki", "raw", "granola") + path.sep)) {
    throw new Error(`Granola raw path must be under wiki/raw/granola: ${rawPath}`);
  }
  return relative;
}

function normalizeExplicitAnyRawPath(
  repoRoot: string,
  rawPath: string,
  allowedSources: RawToWikiSource[],
): string {
  const absolute = path.resolve(repoRoot, rawPath);
  const relative = path.relative(repoRoot, absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Raw source path must be inside the repo: ${rawPath}`);
  }
  const matched = allowedSources.some((source) => {
    return relative.startsWith(path.join("wiki", "raw", source) + path.sep);
  });
  if (!matched) {
    throw new Error(
      `Raw source path must be under one of: ${allowedSources
        .map((source) => `wiki/raw/${source}`)
        .join(", ")}`,
    );
  }
  return relative;
}

async function dedupeRawSourcePaths(repoRoot: string, rawPaths: string[]): Promise<string[]> {
  const slackByThread = new Map<string, { latest: number; rawPath: string }>();
  const result: string[] = [];
  for (const rawPath of rawPaths) {
    if (!rawPath.startsWith(path.join("wiki", "raw", "slack") + path.sep)) {
      result.push(rawPath);
      continue;
    }
    const text = await readFile(path.join(repoRoot, rawPath), "utf8");
    const parsed = parseRawFrontmatter(text);
    const channel = parsed.scalars.channel;
    const threadTs = parsed.scalars.thread_ts;
    if (!channel || !threadTs) {
      result.push(rawPath);
      continue;
    }
    const latest = Number.parseFloat(parsed.scalars.latest_ts ?? threadTs);
    const key = `${channel}:${threadTs}`;
    const previous = slackByThread.get(key);
    if (!previous || latest > previous.latest) {
      slackByThread.set(key, { latest, rawPath });
    }
  }
  return [...result, ...[...slackByThread.values()].map((item) => item.rawPath)].sort();
}

async function upsertPersonPage(
  repoRoot: string,
  person: { label: string; path: string },
  plan: GranolaWikiApplyPlan,
): Promise<boolean> {
  const existing = await readWikiFile(repoRoot, person.path);
  const meetingLine = `- ${plan.draft.date}: ${wikiLink(plan.draft.proposedMeetingPath, plan.draft.title)} (${sourceLink(plan.draft.rawPath)})`;
  const projectLines = plan.classified.projects.map((project) => {
    return `- ${wikiLink(project.path, project.label)}`;
  });
  const next =
    existing ??
    [
      frontmatter({
        type: "person",
        name: person.label,
        last_updated: plan.draft.date,
      }).trimEnd(),
      "",
      `# ${person.label}`,
      "",
      "## Current Context",
      "",
      "- Automatically indexed from meeting transcripts. Review and refine this page as context accumulates.",
      "",
      "## Recent Meetings",
      "",
      "## Projects",
      "",
      "## Open Threads",
      "",
    ].join("\n");
  const updated = updateFrontmatterScalar(
    upsertSectionLines(
      upsertSectionLine(next, "Recent Meetings", meetingLine),
      "Projects",
      projectLines,
    ),
    "last_updated",
    plan.draft.date,
  );
  if (updated === existing) {
    return false;
  }
  await writeWikiFile(repoRoot, person.path, updated);
  return true;
}

async function upsertProjectPage(
  repoRoot: string,
  project: ProjectCandidate,
  plan: GranolaWikiApplyPlan,
): Promise<boolean> {
  const existing = await readWikiFile(repoRoot, project.path);
  const meetingLine = `- ${plan.draft.date}: ${wikiLink(plan.draft.proposedMeetingPath, plan.draft.title)} (${sourceLink(plan.draft.rawPath)})`;
  const sourceMeetingLine = `- ${wikiLink(plan.draft.proposedMeetingPath, plan.draft.title)}`;
  const decisionLines = plan.classified.decisions.map((decision) => {
    return `- ${wikiLink(decision.path, decision.title)}`;
  });
  const threadLines = plan.classified.threads.map((thread) => {
    return `- ${wikiLink(thread.path, thread.title)}`;
  });
  const next =
    existing ??
    [
      frontmatter({
        type: "project",
        title: project.label,
        status: "Indexed from meetings",
        last_updated: plan.draft.date,
      }).trimEnd(),
      "",
      `# ${project.label}`,
      "",
      "## Goal",
      "",
      "- TBD. This page was created automatically from meeting transcripts.",
      "",
      "## Status",
      "",
      "## Decisions",
      "",
      "## Open Threads",
      "",
      "## Timeline",
      "",
      "## Source Meetings",
      "",
    ].join("\n");
  const updated = updateFrontmatterScalar(
    upsertSectionLine(
      upsertSectionLine(
        upsertSectionLines(
          upsertSectionLines(next, "Decisions", decisionLines),
          "Open Threads",
          threadLines,
        ),
        "Timeline",
        meetingLine,
      ),
      "Source Meetings",
      sourceMeetingLine,
    ),
    "last_updated",
    plan.draft.date,
  );
  if (updated === existing) {
    return false;
  }
  await writeWikiFile(repoRoot, project.path, updated);
  return true;
}

async function upsertDecisionPage(
  repoRoot: string,
  decision: EntityCandidate,
  plan: GranolaWikiApplyPlan,
): Promise<boolean> {
  const existing = await readWikiFile(repoRoot, decision.path);
  const sourceLine = `- ${wikiLink(plan.draft.proposedMeetingPath, plan.draft.title)} (${sourceLink(plan.draft.rawPath)})`;
  const next =
    existing ??
    [
      frontmatter({
        type: "decision",
        date: plan.draft.date,
        title: decision.title,
        status: "active",
        source: plan.draft.rawPath.replace(/^wiki\//, ""),
      }).trimEnd(),
      "",
      `# ${decision.title}`,
      "",
      "## Outcome",
      "",
      decision.text,
      "",
      "## Context",
      "",
      `Extracted automatically from ${wikiLink(plan.draft.proposedMeetingPath, plan.draft.title)}.`,
      "",
      "## Source",
      "",
    ].join("\n");
  const updated = upsertSectionLine(next, "Source", sourceLine);
  if (updated === existing) {
    return false;
  }
  await writeWikiFile(repoRoot, decision.path, updated);
  return true;
}

async function upsertThreadPage(
  repoRoot: string,
  thread: EntityCandidate,
  plan: GranolaWikiApplyPlan,
): Promise<boolean> {
  const existing = await readWikiFile(repoRoot, thread.path);
  const sourceLine = `- ${plan.draft.date}: ${wikiLink(plan.draft.proposedMeetingPath, plan.draft.title)} — ${thread.text}`;
  const next =
    existing ??
    [
      frontmatter({
        type: "thread",
        status: "open",
        title: thread.title,
        last_updated: plan.draft.date,
      }).trimEnd(),
      "",
      `# ${thread.title}`,
      "",
      "## Question",
      "",
      thread.text,
      "",
      "## Current State",
      "",
      "Automatically opened from meeting transcript indexing.",
      "",
      "## Timeline",
      "",
      "## Source",
      "",
      `- ${sourceLink(plan.draft.rawPath)}`,
      "",
    ].join("\n");
  const updated = updateFrontmatterScalar(
    upsertSectionLine(next, "Timeline", sourceLine),
    "last_updated",
    plan.draft.date,
  );
  if (updated === existing) {
    return false;
  }
  await writeWikiFile(repoRoot, thread.path, updated);
  return true;
}

async function appendActions(
  repoRoot: string,
  owner: "mine" | "theirs",
  plan: GranolaWikiApplyPlan,
): Promise<boolean> {
  const actions = plan.classified.actions.filter((action) => action.owner === owner);
  if (actions.length === 0) {
    return false;
  }
  const filePath = owner === "mine" ? "wiki/actions/mine.md" : "wiki/actions/theirs.md";
  const existing = await readWikiFile(repoRoot, filePath);
  const base =
    existing ??
    [
      frontmatter({
        type: "actions",
        owner: owner === "mine" ? "me" : "others",
        last_updated: plan.draft.date,
      }).trimEnd(),
      "",
      owner === "mine" ? "# What I Owe Others" : "# What Others Owe Me",
      "",
    ].join("\n");
  const withoutPlaceholder = base.replace(
    /\n- \[ \] Add action items here as they are extracted from sources\.\n?/,
    "\n",
  );
  const lines = actions.map((action) => {
    return `- [ ] ${action.text} (source: ${wikiLink(plan.draft.proposedMeetingPath, plan.draft.title)})`;
  });
  const updated = updateFrontmatterScalar(
    upsertSectionLines(withoutPlaceholder, null, lines),
    "last_updated",
    plan.draft.date,
  );
  if (updated === existing) {
    return false;
  }
  await writeWikiFile(repoRoot, filePath, updated);
  return true;
}

async function updateWikiIndex(repoRoot: string, plan: GranolaWikiApplyPlan): Promise<boolean> {
  const existing = await readWikiFile(repoRoot, "wiki/index.md");
  let next = existing ?? defaultIndexContent();
  next = updateFrontmatterScalar(next, "last_updated", plan.draft.date);
  next = upsertIndexEntry(
    next,
    "Meetings",
    plan.draft.proposedMeetingPath,
    plan.draft.title,
    plan.draft.date,
  );
  for (const person of plan.classified.people) {
    next = upsertIndexEntry(next, "People", person.path, person.label);
  }
  for (const project of plan.classified.projects) {
    next = upsertIndexEntry(next, "Projects", project.path, project.label);
  }
  for (const decision of plan.classified.decisions) {
    next = upsertIndexEntry(next, "Decisions", decision.path, decision.title, plan.draft.date);
  }
  for (const thread of plan.classified.threads) {
    next = upsertIndexEntry(next, "Threads", thread.path, thread.title);
  }
  if (next === existing) {
    return false;
  }
  await writeWikiFile(repoRoot, "wiki/index.md", next);
  return true;
}

async function appendWikiLog(
  repoRoot: string,
  now: Date,
  op: string,
  title: string,
): Promise<string> {
  const logPath = "wiki/log.md";
  const existing = await readWikiFile(repoRoot, logPath);
  const base = existing ?? "# Strata — Activity Log\n";
  const timestamp = now.toISOString().slice(0, 16).replace("T", " ");
  const entry = `\n\n## [${timestamp}] ${op} | ${title}\n`;
  await writeWikiFile(repoRoot, logPath, `${base.trimEnd()}${entry}`);
  return logPath;
}

async function upsertSourcePrimaryPage(
  repoRoot: string,
  plan: SourceWikiApplyPlan,
): Promise<boolean> {
  const existing = await readWikiFile(repoRoot, plan.draft.primaryPath);
  if (existing === undefined) {
    await writeWikiFile(repoRoot, plan.draft.primaryPath, plan.primaryContent);
    return true;
  }
  const updated = updateFrontmatterScalar(
    upsertSectionLine(
      upsertSectionLine(existing, "Source Notes", sourceNoteLine(plan.draft)),
      "Timeline",
      sourceTimelineLine(plan.draft),
    ),
    "last_updated",
    plan.draft.date,
  );
  if (updated === existing) {
    return false;
  }
  await writeWikiFile(repoRoot, plan.draft.primaryPath, updated);
  return true;
}

async function upsertSourcePersonPage(
  repoRoot: string,
  person: { label: string; path: string },
  plan: SourceWikiApplyPlan,
): Promise<boolean> {
  const existing = await readWikiFile(repoRoot, person.path);
  const sourceLine = `- ${plan.draft.date}: ${wikiLink(plan.draft.primaryPath, plan.draft.title)} (${sourceLink(plan.draft.rawPath)})`;
  const projectLines = plan.classified.projects.map((project) => {
    return `- ${wikiLink(project.path, project.label)}`;
  });
  const next =
    existing ??
    [
      frontmatter({
        type: "person",
        name: person.label,
        last_updated: plan.draft.date,
      }).trimEnd(),
      "",
      `# ${person.label}`,
      "",
      "## Current Context",
      "",
      "- Automatically indexed from source material. Review and refine this page as context accumulates.",
      "",
      "## Recent Sources",
      "",
      "## Projects",
      "",
      "## Open Threads",
      "",
    ].join("\n");
  const updated = updateFrontmatterScalar(
    upsertSectionLines(
      upsertSectionLine(next, "Recent Sources", sourceLine),
      "Projects",
      projectLines,
    ),
    "last_updated",
    plan.draft.date,
  );
  if (updated === existing) {
    return false;
  }
  await writeWikiFile(repoRoot, person.path, updated);
  return true;
}

async function upsertSourceProjectPage(
  repoRoot: string,
  project: ProjectCandidate,
  plan: SourceWikiApplyPlan,
): Promise<boolean> {
  const existing = await readWikiFile(repoRoot, project.path);
  const sourceLine = `- ${plan.draft.date}: ${wikiLink(plan.draft.primaryPath, plan.draft.title)} (${sourceLink(plan.draft.rawPath)})`;
  const decisionLines = plan.classified.decisions.map((decision) => {
    return `- ${wikiLink(decision.path, decision.title)}`;
  });
  const threadLines = [
    plan.draft.primaryKind === "thread"
      ? `- ${wikiLink(plan.draft.primaryPath, plan.draft.title)}`
      : "",
    ...plan.classified.threads.map((thread) => `- ${wikiLink(thread.path, thread.title)}`),
  ].filter((line) => line !== "");
  const next =
    existing ??
    [
      frontmatter({
        type: "project",
        title: project.label,
        status: "Indexed from sources",
        last_updated: plan.draft.date,
      }).trimEnd(),
      "",
      `# ${project.label}`,
      "",
      "## Goal",
      "",
      "- TBD. This page was created automatically from source material.",
      "",
      "## Status",
      "",
      "## Decisions",
      "",
      "## Open Threads",
      "",
      "## Timeline",
      "",
      "## Source Notes",
      "",
    ].join("\n");
  const updated = updateFrontmatterScalar(
    upsertSectionLine(
      upsertSectionLines(
        upsertSectionLines(
          upsertSectionLine(next, "Timeline", sourceLine),
          "Decisions",
          decisionLines,
        ),
        "Open Threads",
        threadLines,
      ),
      "Source Notes",
      sourceNoteLine(plan.draft),
    ),
    "last_updated",
    plan.draft.date,
  );
  if (updated === existing) {
    return false;
  }
  await writeWikiFile(repoRoot, project.path, updated);
  return true;
}

async function upsertSourceDecisionPage(
  repoRoot: string,
  decision: EntityCandidate,
  plan: SourceWikiApplyPlan,
): Promise<boolean> {
  const existing = await readWikiFile(repoRoot, decision.path);
  const sourceLine = `- ${wikiLink(plan.draft.primaryPath, plan.draft.title)} (${sourceLink(plan.draft.rawPath)})`;
  const next =
    existing ??
    [
      frontmatter({
        type: "decision",
        date: plan.draft.date,
        title: decision.title,
        status: "active",
        source: plan.draft.rawPath.replace(/^wiki\//, ""),
      }).trimEnd(),
      "",
      `# ${decision.title}`,
      "",
      "## Outcome",
      "",
      decision.text,
      "",
      "## Context",
      "",
      `Extracted automatically from ${wikiLink(plan.draft.primaryPath, plan.draft.title)}.`,
      "",
      "## Source",
      "",
    ].join("\n");
  const updated = upsertSectionLine(next, "Source", sourceLine);
  if (updated === existing) {
    return false;
  }
  await writeWikiFile(repoRoot, decision.path, updated);
  return true;
}

async function upsertSourceThreadPage(
  repoRoot: string,
  thread: EntityCandidate,
  plan: SourceWikiApplyPlan,
): Promise<boolean> {
  const existing = await readWikiFile(repoRoot, thread.path);
  const sourceLine = `- ${plan.draft.date}: ${wikiLink(plan.draft.primaryPath, plan.draft.title)} - ${thread.text}`;
  const next =
    existing ??
    [
      frontmatter({
        type: "thread",
        status: "open",
        title: thread.title,
        last_updated: plan.draft.date,
      }).trimEnd(),
      "",
      `# ${thread.title}`,
      "",
      "## Question",
      "",
      thread.text,
      "",
      "## Current State",
      "",
      "Automatically opened from source indexing.",
      "",
      "## Timeline",
      "",
      "## Source",
      "",
      `- ${sourceLink(plan.draft.rawPath)}`,
      "",
    ].join("\n");
  const updated = updateFrontmatterScalar(
    upsertSectionLine(next, "Timeline", sourceLine),
    "last_updated",
    plan.draft.date,
  );
  if (updated === existing) {
    return false;
  }
  await writeWikiFile(repoRoot, thread.path, updated);
  return true;
}

async function appendSourceActions(
  repoRoot: string,
  owner: "mine" | "theirs",
  plan: SourceWikiApplyPlan,
): Promise<boolean> {
  const actions = plan.classified.actions.filter((action) => action.owner === owner);
  if (actions.length === 0) {
    return false;
  }
  const filePath = owner === "mine" ? "wiki/actions/mine.md" : "wiki/actions/theirs.md";
  const existing = await readWikiFile(repoRoot, filePath);
  const base =
    existing ??
    [
      frontmatter({
        type: "actions",
        owner: owner === "mine" ? "me" : "others",
        last_updated: plan.draft.date,
      }).trimEnd(),
      "",
      owner === "mine" ? "# What I Owe Others" : "# What Others Owe Me",
      "",
    ].join("\n");
  const withoutPlaceholder = base.replace(
    /\n- \[ \] Add action items here as they are extracted from sources\.\n?/,
    "\n",
  );
  const lines = actions.map((action) => {
    return `- [ ] ${action.text} (source: ${wikiLink(plan.draft.primaryPath, plan.draft.title)})`;
  });
  const updated = updateFrontmatterScalar(
    upsertSectionLines(withoutPlaceholder, null, lines),
    "last_updated",
    plan.draft.date,
  );
  if (updated === existing) {
    return false;
  }
  await writeWikiFile(repoRoot, filePath, updated);
  return true;
}

async function updateSourceWikiIndex(
  repoRoot: string,
  plan: SourceWikiApplyPlan,
): Promise<boolean> {
  const existing = await readWikiFile(repoRoot, "wiki/index.md");
  let next = existing ?? defaultIndexContent();
  next = updateFrontmatterScalar(next, "last_updated", plan.draft.date);
  if (plan.draft.primaryKind === "project") {
    next = upsertIndexEntry(next, "Projects", plan.draft.primaryPath, plan.draft.title);
  } else {
    next = upsertIndexEntry(next, "Threads", plan.draft.primaryPath, plan.draft.title);
  }
  for (const person of plan.classified.people) {
    next = upsertIndexEntry(next, "People", person.path, person.label);
  }
  for (const project of plan.classified.projects) {
    next = upsertIndexEntry(next, "Projects", project.path, project.label);
  }
  for (const decision of plan.classified.decisions) {
    next = upsertIndexEntry(next, "Decisions", decision.path, decision.title, plan.draft.date);
  }
  for (const thread of plan.classified.threads) {
    next = upsertIndexEntry(next, "Threads", thread.path, thread.title);
  }
  if (next === existing) {
    return false;
  }
  await writeWikiFile(repoRoot, "wiki/index.md", next);
  return true;
}

async function readWikiFile(repoRoot: string, relativePath: string): Promise<string | undefined> {
  return readTextFileOrUndefined(path.join(repoRoot, relativePath));
}

async function writeWikiFile(
  repoRoot: string,
  relativePath: string,
  content: string,
): Promise<void> {
  await writeTextFile(
    path.join(repoRoot, relativePath),
    content.endsWith("\n") ? content : `${content}\n`,
  );
}

function parseRawFrontmatter(text: string): RawFrontmatter {
  if (!text.startsWith("---\n")) {
    return { scalars: {}, arrays: {} };
  }
  const end = text.indexOf("\n---", 4);
  if (end === -1) {
    return { scalars: {}, arrays: {} };
  }
  const scalars: Record<string, string> = {};
  const arrays: Record<string, string[]> = {};
  let currentArrayKey: string | null = null;
  for (const rawLine of text.slice(4, end).split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    const arrayMatch = /^\s*-\s*(.*)$/.exec(line);
    if (currentArrayKey !== null && arrayMatch) {
      arrays[currentArrayKey]?.push(unquoteYaml(arrayMatch[1] ?? ""));
      continue;
    }
    currentArrayKey = null;
    const keyValue = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!keyValue) {
      continue;
    }
    const key = keyValue[1] ?? "";
    const value = keyValue[2] ?? "";
    if (value === "") {
      arrays[key] = [];
      currentArrayKey = key;
    } else if (value === "[]") {
      arrays[key] = [];
    } else {
      scalars[key] = unquoteYaml(value);
    }
  }
  return { scalars, arrays };
}

function unquoteYaml(value: string): string {
  const trimmed = value.trim();
  if (trimmed === "null" || trimmed === "~") {
    return "";
  }
  return trimmed.replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
}

function normalizeDate(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  const date = value.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

function dateFromRawPath(rawPath: string): string | null {
  const match = /(^|\/)(\d{4}-\d{2}-\d{2})-/.exec(rawPath);
  return match?.[2] ?? null;
}

function firstHeading(body: string): string | null {
  const match = /^#\s+(.+)$/m.exec(body);
  return match?.[1]?.trim() || null;
}

function stripLeadingTitle(body: string): string {
  return body
    .trimStart()
    .replace(/^# .*(?:\r?\n){2}/, "")
    .trim();
}

function candidateLines(body: string, patterns: RegExp[], limit: number): CandidateLine[] {
  const candidates: CandidateLine[] = [];
  const seen = new Set<string>();
  const lines = body.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = (lines[index] ?? "").trim();
    if (line === "" || line.startsWith("#")) {
      continue;
    }
    if (!patterns.some((pattern) => pattern.test(line))) {
      continue;
    }
    const normalized = cleanCandidateText(line);
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    candidates.push({ line: index + 1, text: normalized });
    if (candidates.length >= limit) {
      break;
    }
  }
  return candidates;
}

function speakerCandidates(body: string): string[] {
  return body.split(/\r?\n/).flatMap((line) => {
    const match = /^([A-Z][A-Za-z .'-]{1,60}):\s+\S/.exec(line.trim());
    const name = match?.[1]?.trim() ?? "";
    return looksLikePersonName(name) ? [name] : [];
  });
}

function looksLikePersonName(value: string): boolean {
  if (value === "" || value.includes("@")) {
    return false;
  }
  if (/^(speaker|microphone|summary|transcript|action|decision|next step)$/i.test(value)) {
    return false;
  }
  return value.split(/\s+/).every((part) => /^[A-Z][A-Za-z.'-]*$/.test(part));
}

function projectCandidatesFrom(parsed: RawFrontmatter): string[] {
  const frontmatterProjects = [
    ...(parsed.arrays.projects ?? []),
    parsed.scalars.project ?? "",
    parsed.scalars.folder ?? "",
  ];
  const explicit = frontmatterProjects.filter((item) => item.trim() !== "");
  if (explicit.length > 0) {
    return uniqueStrings(explicit);
  }
  return [];
}

function stripSpeakerPrefix(line: string): string {
  const match = /^([A-Z][A-Za-z .'-]{1,60}):\s+(.+)$/.exec(line);
  return match && looksLikePersonName(match[1] ?? "") ? (match[2] ?? line) : line;
}

function cleanCandidateText(line: string): string {
  return stripSpeakerPrefix(line)
    .replace(/^\s*[-*]\s+/, "")
    .replace(/^\s*\d+\.\s+/, "")
    .replace(/^\[[ x]\]\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function uncertaintyFor(input: {
  attendees: string[];
  projectCandidates: string[];
  actionCandidates: CandidateLine[];
  decisionCandidates: CandidateLine[];
  body: string;
  repoRoot: string;
  proposedMeetingPath: string;
}): string[] {
  const items = [];
  if (input.attendees.length === 0) {
    items.push("No attendees were present in raw frontmatter; people links may be incomplete.");
  }
  if (input.projectCandidates.length === 0) {
    items.push("No explicit project was found; project page updates require manual mapping.");
  }
  if (input.actionCandidates.length === 0) {
    items.push("No action candidates were detected by deterministic heuristics.");
  }
  if (input.decisionCandidates.length === 0) {
    items.push("No decision candidates were detected by deterministic heuristics.");
  }
  if (/\b(Speaker [A-Z]|microphone|speaker):/i.test(input.body)) {
    items.push("Transcript speaker labels appear generic; ownership and attribution need review.");
  }
  if (existsSync(path.join(input.repoRoot, input.proposedMeetingPath))) {
    items.push(`The proposed meeting page already exists at ${input.proposedMeetingPath}.`);
  }
  return items;
}

function proposalEvidence(draft: RawMeetingDraft): string[] {
  return [
    `${draft.rawPath} dated ${draft.date}`,
    draft.sourceUrl ? `Granola source URL: ${draft.sourceUrl}` : "",
    ...draft.actionCandidates.slice(0, 3).map((candidate) => {
      return `${draft.rawPath} action candidate: ${candidate.text}`;
    }),
    ...draft.decisionCandidates.slice(0, 3).map((candidate) => {
      return `${draft.rawPath} decision candidate: ${candidate.text}`;
    }),
  ].filter((item) => item !== "");
}

function formatProposedChange(draft: RawMeetingDraft): string {
  const meetingFrontmatter = frontmatter({
    type: "meeting",
    date: draft.date,
    title: draft.title,
    source: draft.rawPath.replace(/^wiki\//, ""),
    attendees: draft.attendees,
  }).trimEnd();
  const meetingPage = [
    meetingFrontmatter,
    "",
    `# ${draft.title}`,
    "",
    "## Summary",
    "",
    "- Review the Granola source and write a concise meeting summary.",
    "",
    "## Decisions",
    "",
    formatCandidateBullets(draft.decisionCandidates),
    "",
    "## Actions",
    "",
    formatCandidateBullets(draft.actionCandidates),
    "",
    "## Threads",
    "",
    "- Review the source for open questions that should become thread pages.",
    "",
    "## Source",
    "",
    `- ${draft.rawPath}`,
  ].join("\n");

  return [
    `Proposed meeting page: \`${draft.proposedMeetingPath}\``,
    "",
    "```markdown",
    meetingPage,
    "```",
    "",
    "People candidates:",
    formatStringBullets(draft.peopleCandidates),
    "",
    "Project candidates:",
    formatStringBullets(draft.projectCandidates),
    "",
    "Decision candidates:",
    formatCandidateBullets(draft.decisionCandidates),
    "",
    "Action candidates:",
    formatCandidateBullets(draft.actionCandidates),
    "",
    "Uncertainty:",
    formatStringBullets(draft.uncertainty),
  ].join("\n");
}

function formatCandidateBullets(candidates: CandidateLine[]): string {
  if (candidates.length === 0) {
    return "- None detected.";
  }
  return candidates.map((candidate) => `- line ${candidate.line}: ${candidate.text}`).join("\n");
}

function formatStringBullets(items: string[]): string {
  if (items.length === 0) {
    return "- None detected.";
  }
  return items.map((item) => `- ${item}`).join("\n");
}

function uniqueStrings(items: string[]): string[] {
  const seen = new Set<string>();
  const result = [];
  for (const item of items) {
    const normalized = item.trim().replace(/\s+/g, " ");
    if (normalized === "" || seen.has(normalized.toLowerCase())) {
      continue;
    }
    seen.add(normalized.toLowerCase());
    result.push(normalized);
  }
  return result;
}

function projectCandidatesForMeeting(draft: RawMeetingDraft): string[] {
  const candidates = [...draft.projectCandidates];
  const titleProject = projectLabelFromTitle(draft.title);
  if (titleProject) {
    candidates.push(titleProject);
  }
  for (const heading of summaryHeadings(draft.body)) {
    if (isProjectLikeHeading(heading)) {
      candidates.push(cleanProjectLabel(heading));
    }
  }
  return uniqueStrings(candidates).slice(0, 8);
}

function projectLabelsFromTitleAndBody(title: string, body: string): string[] {
  const candidates = [];
  const titleProject = projectLabelFromTitle(title);
  if (titleProject) {
    candidates.push(titleProject);
  }
  for (const heading of summaryHeadings(body)) {
    if (isProjectLikeHeading(heading)) {
      candidates.push(cleanProjectLabel(heading));
    }
  }
  candidates.push(...canonicalProjectLabelsFromText(`${title}\n${body}`));
  return uniqueStrings(candidates).slice(0, 8);
}

function slackProjectLabelsFromTitleAndBody(title: string, body: string): string[] {
  return canonicalProjectLabelsFromText(`${title}\n${body}`).slice(0, 8);
}

function canonicalProjectLabelsFromText(text: string): string[] {
  const candidates = [];
  for (const rule of CANONICAL_PROJECT_PATTERNS) {
    if (rule.patterns.some((pattern) => pattern.test(text))) {
      candidates.push(rule.label);
    }
  }
  return uniqueStrings(candidates);
}

const CANONICAL_PROJECT_PATTERNS: { label: string; patterns: RegExp[] }[] = [
  { label: "Roo Code", patterns: [/\broo\s*code\b/i, /\broocodeinc\b/i] },
  { label: "Roomote", patterns: [/\broomote\b/i, /\bnewmote\b/i] },
  { label: "Slackiness", patterns: [/\bslackiness\b/i] },
  { label: "Granola", patterns: [/\bgranola\b/i] },
  { label: "Notion", patterns: [/\bnotion\b/i] },
  { label: "Slack", patterns: [/\bslack\b/i] },
  { label: "Codex", patterns: [/\bcodex\b/i] },
  { label: "MCP", patterns: [/\bmcp\b/i] },
  { label: "Self Serve", patterns: [/\bself[- ]?serve\b/i] },
  { label: "Pricing", patterns: [/\bpricing\b/i] },
  { label: "Sentry", patterns: [/\bsentry\b/i] },
  { label: "Modal", patterns: [/\bmodal\b/i] },
  { label: "Vercel", patterns: [/\bvercel\b/i] },
  { label: "Sandbox", patterns: [/\bsandbox(?:es)?\b/i] },
  { label: "Feature Flags", patterns: [/\bfeature flags?\b/i] },
  { label: "Security", patterns: [/\bsecurity\b/i] },
  { label: "Billing", patterns: [/\bbilling\b/i] },
  { label: "Quota", patterns: [/\bquota\b/i] },
  { label: "Tokens", patterns: [/\btokens?\b/i] },
  { label: "E2E", patterns: [/\be2e\b/i] },
  { label: "Onboarding", patterns: [/\bonboarding\b/i] },
  { label: "Launch", patterns: [/\blaunch\b/i] },
];

function projectLabelFromTitle(title: string): string | null {
  if (/roo\s*code/i.test(title)) {
    return "Roo Code";
  }
  const stripped = title
    .replace(/\b(daily sync|weekly team meeting|meeting prep|aim to end early)\b/gi, " ")
    .replace(/\s*\/\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (stripped === "" || /^[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}$/.test(stripped)) {
    return null;
  }
  return cleanProjectLabel(stripped);
}

function summaryHeadings(body: string): string[] {
  const summary = meetingSummary({ body } as RawMeetingDraft);
  return [...summary.matchAll(/^###\s+(.+)$/gm)].map((match) => match[1]?.trim() ?? "");
}

function isProjectLikeHeading(value: string): boolean {
  return /\b(product|project|launch|pricing|positioning|onboarding|outbound|content|integration|classifier|framework|architecture|strategy|sentry|slackiness|go-to-market|chores?|roocode|roo code)\b/i.test(
    value,
  );
}

function cleanProjectLabel(value: string): string {
  return value
    .replace(/\s*&\s*/g, " and ")
    .replace(/\b(deep dive|discussion|alignment|updates?|next steps?|progress)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\w\S*/g, (word) => {
      return /^[A-Z]{2,}$/.test(word) ? word : word[0]?.toUpperCase() + word.slice(1);
    });
}

function threadCandidatesForMeeting(_draft: RawMeetingDraft, summary: string): CandidateLine[] {
  const patterns = [
    /\?/,
    /\b(question|unclear|uncertain|concern|challenge|risk|blocked|open issue|why are we not|need to decide|decision needed)\b/i,
  ];
  return candidateLines(summary, patterns, 6);
}

function actionOwner(text: string): "mine" | "theirs" {
  if (/\b(chris|i|i'll|i will)\b/i.test(text)) {
    return "mine";
  }
  return "theirs";
}

function peopleCandidatesForSource(body: string, parsed: RawFrontmatter): string[] {
  const frontmatterPeople = [
    ...(parsed.arrays.attendees ?? []),
    ...(parsed.arrays.people ?? []),
    parsed.scalars.author ?? "",
    parsed.scalars.owner ?? "",
  ];
  const speakerPeople = speakerCandidates(body).filter((name) => !looksLikeMachineUser(name));
  return uniqueStrings([...frontmatterPeople, ...speakerPeople]).filter(looksLikePersonName);
}

function looksLikeMachineUser(value: string): boolean {
  return /^U[A-Z0-9]{6,}$/i.test(value) || /^B[A-Z0-9]{6,}$/i.test(value);
}

interface SlackMaterialityInput {
  body: string;
  messages: string[];
  parsed: RawFrontmatter;
  title: string;
}

type SlackMaterialityResult = { material: true } | { material: false; reason: string };

function slackMateriality(input: SlackMaterialityInput): SlackMaterialityResult {
  const meaningfulMessages = input.messages.filter(isMeaningfulSlackMessage);
  if (meaningfulMessages.length === 0) {
    return { material: false, reason: "Slack thread contains no message text." };
  }

  const combined = normalizeSlackText([input.title, ...meaningfulMessages.slice(0, 12)].join("\n"));
  const signalCombined = slackSignalText(combined);
  const nonLogCombined = slackSignalText(
    meaningfulMessages
      .filter((message) => !looksLikeSlackLogMessage(message))
      .filter((message) => !isSlackStatusOnlyMessage(message))
      .join("\n"),
  );
  const actionCandidates = candidateLines(signalCombined, ACTION_PATTERNS, 1);
  const decisionCandidates = candidateLines(signalCombined, DECISION_PATTERNS, 1);
  const hasMaterialSignal =
    SLACK_MATERIAL_PATTERNS.some((pattern) => pattern.test(signalCombined)) ||
    actionCandidates.length > 0 ||
    decisionCandidates.length > 0;
  const hasNonLogMaterialSignal =
    nonLogCombined !== "" &&
    SLACK_MATERIAL_PATTERNS.some((pattern) => pattern.test(nonLogCombined));
  const lowSignalTitle = SLACK_LOW_SIGNAL_PATTERNS.some((pattern) => pattern.test(combined));
  const statusOnly = meaningfulMessages.every(isSlackStatusOnlyMessage);
  const linkOnly = isSlackLinkOnlyThread(input.title, meaningfulMessages);

  if (lowSignalTitle && !hasNonLogMaterialSignal) {
    return {
      material: false,
      reason: "Slack thread appears to be an automation/log notification.",
    };
  }
  if (statusOnly && !hasMaterialSignal) {
    return {
      material: false,
      reason: "Slack thread only contains routine status/progress updates.",
    };
  }
  if (linkOnly) {
    return {
      material: false,
      reason: "Slack thread only contains links and no material context.",
    };
  }
  if (!hasMaterialSignal) {
    return {
      material: false,
      reason: "Slack thread has no material ask, decision, action, incident, or project signal.",
    };
  }

  return { material: true };
}

function normalizeSlackText(value: string): string {
  return value
    .replace(/<@U[A-Z0-9]+>/gi, " ")
    .replace(/<!subteam\^[^>]+>/gi, " ")
    .replace(/<([^|>]+)\|([^>]+)>/g, "$2 $1")
    .replace(/<([^>]+)>/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function slackSignalText(value: string): string {
  return normalizeSlackText(value)
    .replace(/\bhttps?:\/\/\S+/gi, " ")
    .replace(/\bwww\.\S+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isSlackLinkOnlyThread(title: string, messages: string[]): boolean {
  if (messages.length > 2) {
    return false;
  }
  const textWithoutLinks = slackSignalText([title, ...messages].join(" "))
    .replace(/[:#|*_`~>\[\](){}.!?,;-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return textWithoutLinks.length < 24;
}

function isMeaningfulSlackMessage(message: string): boolean {
  const normalized = normalizeSlackText(message);
  if (normalized === "" || /^_?no text_?$/i.test(normalized)) {
    return false;
  }
  return !/^reactions?:/i.test(normalized);
}

function isSlackStatusOnlyMessage(message: string): boolean {
  const normalized = normalizeSlackText(message).toLowerCase();
  return (
    /^_?no text_?$/.test(normalized) ||
    /^getting started on your task\b/.test(normalized) ||
    /^i'?m (looking|pulling|running|checking|working|letting|in the final|going)\b/.test(
      normalized,
    ) ||
    /^validation (is )?(green|passed)\b/.test(normalized) ||
    /^pre-commit hooks\b/.test(normalized) ||
    /^draft pr is up\b/.test(normalized) ||
    /^addressed (the )?(pr|latest pr|latest) feedback\b/.test(normalized) ||
    /^done\b/.test(normalized) ||
    /\bwas merged by\b/.test(normalized)
  );
}

function looksLikeSlackLogMessage(message: string): boolean {
  const normalized = normalizeSlackText(message).toLowerCase();
  return (
    /^\[?roomote-(worker|dispatcher)\]?/.test(normalized) ||
    /^\[?roomote\]?\s+error\b/.test(normalized) ||
    /^roomote (worker|dispatcher|error)\b/.test(normalized) ||
    /\bcodex-acp:stderr\b/.test(normalized) ||
    /\btrpcclienterror\b/.test(normalized) ||
    /\bquota exceeded\b/.test(normalized) ||
    /\binvalid prompt\b/.test(normalized) ||
    /\bpolicy\b/.test(normalized) ||
    /\bunhandled error during turn\b/.test(normalized) ||
    /(?:\bbell\b|:bell:)\s*[: -]?\s*(unsuccessful|new user|new waitlist|platform issue|prompt requests|alternative software|yesterday)\b/.test(
      normalized,
    ) ||
    /\bnew support ticket\b/.test(normalized) ||
    /\bmetabaseapp\.com\/question\b/.test(normalized) ||
    /\b(status\.[a-z0-9.-]+|githubstatus\.com|vercel-status\.com)\b/.test(normalized) ||
    /^\*?(codepush|deploy(?:[- ][a-z0-9]+)*)\*?.*\b(starting|success)\b/.test(normalized) ||
    /^release merged to\s+[`'"]?main[`'"]?\b/.test(normalized) ||
    /\bhandshake-new-linkedin-connection-accepted-prospect\b/.test(normalized) ||
    /\broomote e2e (failed|passed)\b/.test(normalized) ||
    /^published\b.+\bsuccessfully to npm\b/.test(normalized) ||
    /\b(detached worker run exited|error level error is not supported)\b/.test(normalized) ||
    /\bweekly stats\b/.test(normalized)
  );
}

function meetingSummary(draft: Pick<RawMeetingDraft, "body">): string {
  const match = /## Summary\s+([\s\S]*?)(?:\n---\n|\n## Transcript\b|$)/.exec(draft.body);
  const summary = match?.[1]?.trim();
  if (summary) {
    return summary;
  }
  const lines = draft.body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"))
    .slice(0, 8);
  return lines.length > 0 ? lines.map((line) => `- ${line}`).join("\n") : "- No summary available.";
}

function sourceSummary(body: string): string {
  const existing = meetingSummary({ body } as RawMeetingDraft);
  if (existing !== "- No summary available.") {
    return existing;
  }
  const lines = body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"))
    .filter((line) => !/^reactions?:/i.test(line))
    .slice(0, 10);
  return lines.length > 0 ? lines.map((line) => `- ${line}`).join("\n") : "- No summary available.";
}

function slackSummary(messages: string[], title: string): string {
  const selected = messages
    .filter(isMeaningfulSlackMessage)
    .filter((message) => !isSlackStatusOnlyMessage(message))
    .slice(0, 8);
  if (selected.length === 0) {
    return `- ${title}`;
  }
  return selected.map((message) => `- ${message}`).join("\n");
}

function slackMessageTexts(body: string): string[] {
  const messages: string[] = [];
  let current: string[] = [];
  const flush = () => {
    const text = current
      .map((line) => line.trim())
      .filter((line) => line !== "" && !/^reactions?:/i.test(line))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (text !== "") {
      messages.push(text);
    }
    current = [];
  };
  for (const line of body.split(/\r?\n/)) {
    if (/^##\s+\d+\.\d+\s+\|/.test(line)) {
      flush();
      continue;
    }
    if (line.startsWith("#")) {
      continue;
    }
    current.push(line);
  }
  flush();
  return messages;
}

function slackParticipantsFromHeadings(body: string): string[] {
  return uniqueStrings(
    [...body.matchAll(/^##\s+\d+\.\d+\s+\|\s+(.+)$/gm)].map((match) => {
      return (match[1] ?? "").trim();
    }),
  )
    .filter((name) => !looksLikeMachineUser(name))
    .filter(looksLikePersonName);
}

function threadCandidatesForSource(summary: string, limit: number): CandidateLine[] {
  return candidateLines(
    summary,
    [
      /\?/,
      /\b(question|unclear|concern|challenge|risk|blocked|open issue|need to decide|decision needed)\b/i,
    ],
    limit,
  );
}

function sourceNoteLine(draft: SourceWikiDraft): string {
  return `- ${draft.date}: ${wikiLink(draft.primaryPath, draft.title)} (${sourceLink(draft.rawPath)})`;
}

function sourceTimelineLine(draft: SourceWikiDraft): string {
  return `- ${draft.date}: Indexed ${draft.source} source ${sourceLink(draft.rawPath)}`;
}

function formatSourceLines(draft: SourceWikiDraft): string[] {
  const lines = [
    `- Raw source: [${draft.rawPath.replace(/^wiki\//, "")}](${relativeSourceLink(draft.rawPath)})`,
  ];
  if (draft.sourceUrl) {
    lines.push(`- ${sourceDisplayName(draft.source)}: ${draft.sourceUrl}`);
  }
  return lines;
}

function sourceDisplayName(source: RawToWikiSource): string {
  return source[0]?.toUpperCase() + source.slice(1);
}

function firstSummaryLine(summary: string): string {
  return (
    summary
      .split(/\r?\n/)
      .map((line) => cleanCandidateText(line))
      .find((line) => line !== "") ?? ""
  );
}

function slackTsSlug(value: string): string {
  return value.replace(/\D+/g, "") || "thread";
}

function sentenceTitle(text: string): string {
  return text
    .replace(/^[-*\s]+/, "")
    .replace(/^\[[ x]\]\s*/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.。]+$/, "")
    .slice(0, 96);
}

function formatEntityLinks(items: { path: string; label?: string; title?: string }[]): string {
  if (items.length === 0) {
    return "- None indexed.";
  }
  return items
    .map((item) => `- ${wikiLink(item.path, item.label ?? item.title ?? item.path)}`)
    .join("\n");
}

function formatSourcePrimaryPage(
  draft: SourceWikiDraft,
  classified: SourceClassified,
  now: Date,
): string {
  if (draft.primaryKind === "project") {
    return [
      frontmatter({
        type: "project",
        title: draft.title,
        status: `Indexed from ${draft.source}`,
        source: draft.rawPath.replace(/^wiki\//, ""),
        last_updated: draft.date,
        indexed_at: now.toISOString(),
      }).trimEnd(),
      "",
      `# ${draft.title}`,
      "",
      "## Goal",
      "",
      "- TBD. This page was created automatically from source material.",
      "",
      "## Status",
      "",
      draft.summary,
      "",
      "## Decisions",
      "",
      formatEntityLinks(classified.decisions),
      "",
      "## Open Threads",
      "",
      formatEntityLinks(classified.threads),
      "",
      "## Actions",
      "",
      formatActionBullets(classified.actions),
      "",
      "## Source Notes",
      "",
      sourceNoteLine(draft),
      "",
      "## Source",
      "",
      ...formatSourceLines(draft),
      "",
    ].join("\n");
  }
  return [
    frontmatter({
      type: "thread",
      status: "open",
      title: draft.title,
      source: draft.rawPath.replace(/^wiki\//, ""),
      last_updated: draft.date,
      indexed_at: now.toISOString(),
    }).trimEnd(),
    "",
    `# ${draft.title}`,
    "",
    "## Question",
    "",
    firstSummaryLine(draft.summary) || draft.title,
    "",
    "## Current State",
    "",
    draft.summary,
    "",
    "## Projects",
    "",
    formatEntityLinks(classified.projects),
    "",
    "## Decisions",
    "",
    formatEntityLinks(classified.decisions),
    "",
    "## Actions",
    "",
    formatActionBullets(classified.actions),
    "",
    "## Timeline",
    "",
    sourceTimelineLine(draft),
    "",
    "## Source",
    "",
    ...formatSourceLines(draft),
    "",
  ].join("\n");
}

function formatActionBullets(actions: ActionCandidate[]): string {
  if (actions.length === 0) {
    return "- None indexed.";
  }
  return actions
    .map((action) => {
      const target = action.owner === "mine" ? "actions/mine" : "actions/theirs";
      const label = action.owner === "mine" ? "mine" : "theirs";
      return `- ${action.text} -> [[${target}|${label}]]`;
    })
    .join("\n");
}

function wikiLink(repoRelativePath: string, label: string): string {
  const wikiRelativePath = repoRelativePath
    .replace(/^wiki\//, "")
    .replace(/\.md$/, "")
    .replace(/\\/g, "/");
  return `[[${wikiRelativePath}|${label}]]`;
}

function sourceLink(rawPath: string): string {
  return `[${rawPath.replace(/^wiki\//, "")}](${rawPath.replace(/^wiki\//, "../")})`;
}

function relativeSourceLink(rawPath: string): string {
  return rawPath.replace(/^wiki\//, "../");
}

function dedupeByPath<T extends { path: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const result = [];
  for (const item of items) {
    const key = item.path.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(item);
  }
  return result;
}

function updateFrontmatterScalar(text: string, key: string, value: string): string {
  if (!text.startsWith("---\n")) {
    return text;
  }
  const end = text.indexOf("\n---", 4);
  if (end === -1) {
    return text;
  }
  const before = text.slice(0, end);
  const after = text.slice(end);
  const pattern = new RegExp(`^${escapeRegExp(key)}:\\s*.*$`, "m");
  const line = `${key}: ${value}`;
  if (pattern.test(before)) {
    return `${before.replace(pattern, line)}${after}`;
  }
  return `${before}\n${line}${after}`;
}

function upsertSectionLines(text: string, section: string | null, lines: string[]): string {
  return lines.reduce((current, line) => upsertSectionLine(current, section, line), text);
}

function upsertSectionLine(text: string, section: string | null, line: string): string {
  if (line.trim() === "" || text.includes(line)) {
    return text;
  }
  if (section === null) {
    return `${text.trimEnd()}\n${line}\n`;
  }
  const heading = `## ${section}`;
  const headingIndex = text.indexOf(heading);
  if (headingIndex === -1) {
    return `${text.trimEnd()}\n\n${heading}\n\n${line}\n`;
  }
  const insertStart = headingIndex + heading.length;
  const nextHeading = text.indexOf("\n## ", insertStart);
  const beforeSection = text.slice(0, insertStart);
  const sectionBody =
    nextHeading === -1 ? text.slice(insertStart) : text.slice(insertStart, nextHeading);
  const afterSection = nextHeading === -1 ? "" : text.slice(nextHeading);
  const trimmedBody = sectionBody.trimEnd();
  const separator = trimmedBody === "" ? "\n\n" : "\n";
  return `${beforeSection}${trimmedBody}${separator}${line}\n${afterSection.replace(/^\n?/, "")}`;
}

function upsertIndexEntry(
  text: string,
  section: string,
  targetPath: string,
  label: string,
  description = "",
): string {
  const target = targetPath
    .replace(/^wiki\//, "")
    .replace(/\.md$/, "")
    .replace(/\\/g, "/");
  const suffix = description ? ` — ${description}` : "";
  const line = `- [[${target}|${label}]]${suffix}`;
  return upsertSectionLine(text, section, line);
}

function defaultIndexContent(): string {
  return [
    "---",
    "type: index",
    "last_updated: null",
    "---",
    "",
    "# Strata Index",
    "",
    "## People",
    "",
    "## Projects",
    "",
    "## Teams",
    "",
    "## Meetings",
    "",
    "## Decisions",
    "",
    "## Threads",
    "",
    "## Actions",
    "",
    "- [[actions/mine|What I owe others]]",
    "- [[actions/theirs|What others owe me]]",
    "",
  ].join("\n");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export type { RawMeetingDraft };
