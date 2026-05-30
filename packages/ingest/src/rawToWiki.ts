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
import {
  type IngestTaxonomy,
  loadIngestTaxonomy,
  type ResolvedIngestTaxonomy,
} from "./ingestTaxonomy.js";
import {
  canonicalProjectLabelForText,
  normalizeProjectLabels,
  projectLabelsFromTaxonomyText,
} from "./raw-to-wiki/entityResolution.js";
import {
  candidateLines,
  cleanCandidateText,
  decisionCandidateLines,
  looksLikePersonName,
  speakerCandidates,
} from "./raw-to-wiki/extraction.js";
import { slackMateriality, slackSummary } from "./raw-to-wiki/materiality.js";
import { slackMessageTexts, slackParticipantsFromHeadings } from "./raw-to-wiki/slack.js";
import type { CandidateLine, ClassificationReason, RawFrontmatter } from "./raw-to-wiki/types.js";

export type { CandidateLine, ClassificationReason } from "./raw-to-wiki/types.js";

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
  decisionCandidates: CandidateLine[];
  uncertainty: string[];
  proposalPath: string;
}

export interface GranolaRawToWikiSkip {
  rawPath: string;
  reason: string;
  classificationReasons?: ClassificationReason[];
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
  taxonomy?: IngestTaxonomy;
  profile?: IngestTaxonomy;
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
  writtenPaths: string[];
  classificationReasons: ClassificationReason[];
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
  taxonomy?: IngestTaxonomy;
  profile?: IngestTaxonomy;
}

export interface RawToWikiIndexItem {
  source: RawToWikiSource;
  rawPath: string;
  primaryKind: "meeting" | "project" | "source" | "thread";
  primaryPath: string;
  title: string;
  date: string;
  peoplePaths: string[];
  projectPaths: string[];
  decisionPaths: string[];
  threadPaths: string[];
  writtenPaths: string[];
  classificationReasons: ClassificationReason[];
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

interface RawToWikiPlanApplyResult {
  writtenPaths: string[];
}

interface SourceWikiDraft {
  source: Exclude<RawToWikiSource, "granola">;
  rawPath: string;
  title: string;
  date: string;
  sourceUrl: string | null;
  body: string;
  summary: string;
  primaryKind: "project" | "source" | "thread";
  primaryPath: string;
  peopleCandidates: string[];
  projectCandidates: string[];
  decisionCandidates: CandidateLine[];
  threadCandidates: CandidateLine[];
  metadata: RawFrontmatter;
  classificationReasons: ClassificationReason[];
}

interface SkippedRawSourceDraft {
  skipped: true;
  rawPath: string;
  reason: string;
  classificationReasons?: ClassificationReason[];
}

interface SourceClassified {
  people: { label: string; path: string }[];
  projects: ProjectCandidate[];
  decisions: EntityCandidate[];
  threads: EntityCandidate[];
  classificationReasons: ClassificationReason[];
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
  classificationReasons: ClassificationReason[];
}

interface GranolaWikiApplyPlan {
  draft: RawMeetingDraft;
  classified: ClassifiedMeeting;
  meetingContent: string;
  writtenPaths: string[];
}

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
          "Granola raw snapshots are immutable source material. This stages the first wiki meeting page and related entity candidates for human review before any wiki pages are edited.",
        evidence: proposalEvidence(draft),
        proposedChange: formatProposedChange(draft),
        risk: "Medium. The source transcript may omit speaker identity or context, so project links and decisions need manual review before applying.",
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
      writtenPaths: item.writtenPaths,
      classificationReasons: item.classificationReasons,
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
  const taxonomy = await loadIngestTaxonomy(repoRoot, options.taxonomy ?? options.profile);
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
      taxonomyPath: taxonomy.path,
      taxonomyFound: taxonomy.found,
      taxonomySource: taxonomy.source,
    });

    const indexed: RawToWikiIndexItem[] = [];
    const skipped: GranolaRawToWikiSkip[] = [];

    for (const rawPath of rawPaths) {
      const absoluteRawPath = path.resolve(repoRoot, rawPath);
      const relativeRawPath = path.relative(repoRoot, absoluteRawPath);
      const text = await readFile(absoluteRawPath, "utf8");
      const draft = buildRawSourceDraft(repoRoot, relativeRawPath, text, taxonomy);
      if (draft === null) {
        const skippedItem = {
          rawPath: relativeRawPath,
          reason: "Raw file is not a supported Strata raw source snapshot.",
        };
        skipped.push(skippedItem);
        await store.appendEvent(session.id, "raw_to_wiki.index.skipped", {
          ...skippedItem,
          dryRun,
          source: sourceLabel,
        });
        continue;
      }
      if (isSkippedRawSourceDraft(draft)) {
        const skippedItem = {
          rawPath: draft.rawPath,
          reason: draft.reason,
          ...(draft.classificationReasons === undefined
            ? {}
            : { classificationReasons: draft.classificationReasons }),
        };
        skipped.push(skippedItem);
        await store.appendEvent(session.id, "raw_to_wiki.index.skipped", {
          ...skippedItem,
          dryRun,
          source: sourceLabel,
        });
        continue;
      }
      if (await sourceDraftAlreadyIndexed(repoRoot, draft)) {
        const skippedItem = {
          rawPath: relativeRawPath,
          reason: `Source already indexed at ${primaryPathForDraft(draft)}.`,
        };
        skipped.push(skippedItem);
        await store.appendEvent(session.id, "raw_to_wiki.index.skipped", {
          ...skippedItem,
          dryRun,
          source: sourceLabel,
        });
        continue;
      }

      const plan = buildSourceApplyPlan(repoRoot, draft, now, taxonomy);
      const applyResult = dryRun
        ? dryRunApplyResult(plan)
        : await applySourceWikiPlan(repoRoot, plan);
      const item = rawToWikiIndexItem(plan, applyResult.writtenPaths);
      indexed.push(item);
      await store.appendEvent(session.id, "raw_to_wiki.index.item", {
        source: item.source,
        rawPath: item.rawPath,
        primaryKind: item.primaryKind,
        primaryPath: item.primaryPath,
        title: item.title,
        date: item.date,
        peoplePaths: item.peoplePaths,
        projectPaths: item.projectPaths,
        decisionPaths: item.decisionPaths,
        threadPaths: item.threadPaths,
        writtenPaths: item.writtenPaths,
        classificationReasons: item.classificationReasons,
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
      skipped: skipped.map((item) => ({
        rawPath: item.rawPath,
        reason: item.reason,
        ...(item.classificationReasons === undefined
          ? {}
          : { classificationReasons: item.classificationReasons }),
      })),
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
  const decisionCandidates = decisionCandidateLines(body, 12);
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
    decisionCandidates,
    uncertainty: uncertaintyFor({
      attendees,
      projectCandidates,
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
  taxonomy: ResolvedIngestTaxonomy,
): GranolaWikiApplyPlan {
  const classified = classifyGranolaMeeting(draft, taxonomy);
  const meetingContent = formatMeetingPage(draft, classified, now);
  const writtenPaths = uniqueStrings([
    draft.proposedMeetingPath,
    ...classified.people.map((item) => item.path),
    ...classified.projects.map((item) => item.path),
    ...classified.decisions.map((item) => item.path),
    ...classified.threads.map((item) => item.path),
    "wiki/index.md",
    "wiki/log.md",
  ]);
  return { draft, classified, meetingContent, writtenPaths };
}

async function applyGranolaWikiPlan(
  repoRoot: string,
  plan: GranolaWikiApplyPlan,
): Promise<RawToWikiPlanApplyResult> {
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
  if (await updateWikiIndex(repoRoot, plan)) {
    written.add("wiki/index.md");
  }
  return { writtenPaths: [...written] };
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
    writtenPaths,
    classificationReasons: plan.classified.classificationReasons,
  };
}

function buildRawSourceDraft(
  repoRoot: string,
  rawPath: string,
  text: string,
  taxonomy: ResolvedIngestTaxonomy,
): RawMeetingDraft | SourceWikiDraft | SkippedRawSourceDraft | null {
  const parsed = parseRawFrontmatter(text);
  const source = sourceFromRaw(rawPath, parsed);
  if (source === "granola") {
    return buildGranolaMeetingDraft(repoRoot, rawPath, text);
  }
  if (source === "notion") {
    return buildNotionSourceDraft(rawPath, text, parsed, taxonomy);
  }
  if (source === "slack") {
    return buildSlackSourceDraft(rawPath, text, parsed, taxonomy);
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
  taxonomy: ResolvedIngestTaxonomy,
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
  const primaryTitleLabel = cleanProjectLabel(title);
  const primaryLabel =
    canonicalProjectLabelForText(primaryTitleLabel, taxonomy) ?? primaryTitleLabel;
  const aliasMatches = projectLabelsFromTaxonomyText(`${title}\n${body}`, taxonomy);
  const projectCandidates = normalizeProjectLabels(
    uniqueStrings([
      primaryLabel,
      ...projectCandidatesFrom(parsed),
      ...projectLabelsFromTitleAndBody(title, body, taxonomy),
    ]),
    taxonomy,
  ).slice(0, 8);
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
    decisionCandidates: decisionCandidateLines(summary, 8),
    threadCandidates: threadCandidatesForSource(summary, 8),
    metadata: parsed,
    classificationReasons: aliasMatches.reasons,
  };
}

function buildSlackSourceDraft(
  rawPath: string,
  text: string,
  parsed: RawFrontmatter,
  taxonomy: ResolvedIngestTaxonomy,
): SourceWikiDraft | SkippedRawSourceDraft | null {
  if (parsed.scalars.type !== "raw_slack_thread" && parsed.scalars.source !== "slack") {
    return null;
  }
  const split = splitFrontmatter(text);
  const body = stripLeadingTitle(split.body);
  const title = parsed.scalars.title || firstHeading(split.body) || "Slack thread";
  const messages = slackMessageTexts(body);
  const materiality = slackMateriality({ body, messages, parsed, title, taxonomy });
  if (!materiality.material) {
    return {
      skipped: true,
      rawPath,
      reason: materiality.reason,
      classificationReasons: materiality.classificationReasons,
    };
  }
  const date =
    normalizeDate(parsed.scalars.date) ??
    dateFromRawPath(rawPath) ??
    utcNow().toISOString().slice(0, 10);
  const summary = slackSummary(messages, title, taxonomy);
  const channel = parsed.scalars.channel || "slack";
  const threadTs = parsed.scalars.thread_ts || slugify(title, "thread");
  const primarySlug = `${date}-${slackTsSlug(threadTs)}-${slugify(title, "thread")}`;
  return {
    source: "slack",
    rawPath,
    title,
    date,
    sourceUrl: parsed.scalars.source_url || null,
    body,
    summary,
    primaryKind: "source",
    primaryPath: path.join("wiki", "sources", "slack", slugify(channel), `${primarySlug}.md`),
    peopleCandidates: slackParticipantsFromHeadings(body)
      .filter((name) => !looksLikeMachineUser(name))
      .filter(looksLikePersonName)
      .slice(0, 16),
    projectCandidates: slackProjectLabelsFromTitleAndBody(title, body, taxonomy).slice(0, 8),
    decisionCandidates: decisionCandidateLines(summary, 8),
    threadCandidates: promotedSlackThreadCandidates(summary, 3),
    metadata: parsed,
    classificationReasons: [
      ...materiality.classificationReasons,
      ...projectLabelsFromTaxonomyText(`${title}\n${body}`, taxonomy).reasons,
    ],
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
  taxonomy: ResolvedIngestTaxonomy,
): GranolaWikiApplyPlan | SourceWikiApplyPlan {
  if ("proposedMeetingPath" in draft) {
    return buildGranolaWikiApplyPlan(repoRoot, draft, now, taxonomy);
  }
  const classified = classifySourceDraft(draft, taxonomy);
  const primaryContent = formatSourcePrimaryPage(draft, classified, now);
  const writtenPaths = uniqueStrings([
    draft.primaryPath,
    ...classified.people.map((item) => item.path),
    ...classified.projects.map((item) => item.path),
    ...classified.decisions.map((item) => item.path),
    ...classified.threads.map((item) => item.path),
    "wiki/index.md",
    "wiki/log.md",
  ]);
  return { draft, classified, primaryContent, writtenPaths };
}

function dryRunApplyResult(
  plan: GranolaWikiApplyPlan | SourceWikiApplyPlan,
): RawToWikiPlanApplyResult {
  return {
    writtenPaths: plan.writtenPaths,
  };
}

async function applySourceWikiPlan(
  repoRoot: string,
  plan: GranolaWikiApplyPlan | SourceWikiApplyPlan,
): Promise<RawToWikiPlanApplyResult> {
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
  if (await updateSourceWikiIndex(repoRoot, plan)) {
    written.add("wiki/index.md");
  }
  return { writtenPaths: [...written] };
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
      writtenPaths,
      classificationReasons: item.classificationReasons,
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
    writtenPaths,
    classificationReasons: plan.classified.classificationReasons,
  };
}

function classifyGranolaMeeting(
  draft: RawMeetingDraft,
  taxonomy: ResolvedIngestTaxonomy,
): ClassifiedMeeting {
  const summary = meetingSummary(draft);
  const aliasMatches = projectLabelsFromTaxonomyText(`${draft.title}\n${draft.body}`, taxonomy);
  const summaryDecisionCandidates = decisionCandidateLines(summary, 6);
  const people = draft.peopleCandidates.map((name) => ({
    label: name,
    path: path.join("wiki", "people", `${slugify(name, "person")}.md`),
  }));
  const projects = projectCandidatesForMeeting(draft, taxonomy).map((label) => ({
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
  return {
    people: dedupeByPath(people),
    projects: dedupeByPath(projects).slice(0, 6),
    decisions: dedupeByPath(decisions),
    threads: dedupeByPath(threads).slice(0, 6),
    classificationReasons: aliasMatches.reasons,
  };
}

function classifySourceDraft(
  draft: SourceWikiDraft,
  taxonomy: ResolvedIngestTaxonomy,
): SourceClassified {
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
  return {
    people: dedupeByPath(people),
    projects: dedupeByPath(projects).slice(0, 6),
    decisions: dedupeByPath(decisions).slice(0, 6),
    threads: dedupeByPath(threads).slice(0, 6),
    classificationReasons: draft.classificationReasons,
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

async function updateSourceWikiIndex(
  repoRoot: string,
  plan: SourceWikiApplyPlan,
): Promise<boolean> {
  const existing = await readWikiFile(repoRoot, "wiki/index.md");
  let next = existing ?? defaultIndexContent();
  next = updateFrontmatterScalar(next, "last_updated", plan.draft.date);
  if (plan.draft.primaryKind === "project") {
    next = upsertIndexEntry(next, "Projects", plan.draft.primaryPath, plan.draft.title);
  } else if (plan.draft.primaryKind === "thread") {
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

function uncertaintyFor(input: {
  attendees: string[];
  projectCandidates: string[];
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

function projectCandidatesForMeeting(
  draft: RawMeetingDraft,
  taxonomy: ResolvedIngestTaxonomy,
): string[] {
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
  candidates.push(
    ...projectLabelsFromTaxonomyText(`${draft.title}\n${draft.body}`, taxonomy).labels,
  );
  return normalizeProjectLabels(candidates, taxonomy).slice(0, 8);
}

function projectLabelsFromTitleAndBody(
  title: string,
  body: string,
  taxonomy: ResolvedIngestTaxonomy,
): string[] {
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
  candidates.push(...projectLabelsFromTaxonomyText(`${title}\n${body}`, taxonomy).labels);
  return normalizeProjectLabels(candidates, taxonomy).slice(0, 8);
}

function slackProjectLabelsFromTitleAndBody(
  title: string,
  body: string,
  taxonomy: ResolvedIngestTaxonomy,
): string[] {
  return projectLabelsFromTaxonomyText(`${title}\n${body}`, taxonomy).labels.slice(0, 8);
}

function projectLabelFromTitle(title: string): string | null {
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
  return /\b(project|initiative|workstream|program|roadmap|strategy|architecture|launch)\b/i.test(
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

function promotedSlackThreadCandidates(summary: string, limit: number): CandidateLine[] {
  return candidateLines(
    summary,
    [
      /\b(blocked|unresolved|open issue|open question|decision needed|need to decide)\b/i,
      /\b(risk|concern|follow[- ]?up|owner:|due:|next step)\b/i,
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
  if (draft.primaryKind === "source") {
    return [
      frontmatter({
        type: `${draft.source}_source`,
        source_type: draft.source,
        title: draft.title,
        source: draft.rawPath.replace(/^wiki\//, ""),
        last_updated: draft.date,
        indexed_at: now.toISOString(),
      }).trimEnd(),
      "",
      `# ${draft.title}`,
      "",
      "## Summary",
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
      "## Promoted Threads",
      "",
      formatEntityLinks(classified.threads),
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
