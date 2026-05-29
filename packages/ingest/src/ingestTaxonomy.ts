import path from "node:path";
import {
  getStrataPaths,
  type LearningProposalRecord,
  readJsonFileOrUndefined,
  readLearningProposal,
  SessionStore,
  updateLearningProposalStatus,
  writeJsonFile,
  writeOrReuseLearningProposal,
} from "@strata/core";

export type IngestPatternMatch = "literal" | "regex";

export interface IngestPatternRule {
  value: string;
  match?: IngestPatternMatch;
  flags?: string;
  reason?: string;
}

export interface IngestProjectRule {
  label: string;
  aliases?: string[];
}

export interface IngestSlackTaxonomy {
  materialPatterns?: IngestPatternRule[];
  ignoredLogPatterns?: IngestPatternRule[];
  transientCheckPatterns?: IngestPatternRule[];
  routineCoordinationPatterns?: IngestPatternRule[];
  statusOnlyPatterns?: IngestPatternRule[];
}

export interface IngestTaxonomy {
  version: 1;
  selfNames?: string[];
  projects?: IngestProjectRule[];
  slack?: IngestSlackTaxonomy;
}

export type IngestSlackPatternField = keyof Required<IngestSlackTaxonomy>;

export interface ResolvedIngestPatternRule {
  pattern: RegExp;
  value: string;
  match: IngestPatternMatch;
  flags: string;
  reason: string | null;
  source: "taxonomy";
  field: string;
}

export interface ResolvedIngestProjectRule {
  label: string;
  patterns: RegExp[];
  aliases: ResolvedIngestPatternRule[];
}

export interface ResolvedIngestTaxonomy {
  path: string | null;
  found: boolean;
  source: "taxonomy" | "legacy-profile" | "override";
  selfNames: string[];
  projects: ResolvedIngestProjectRule[];
  slack: {
    materialPatterns: ResolvedIngestPatternRule[];
    ignoredLogPatterns: ResolvedIngestPatternRule[];
    transientCheckPatterns: ResolvedIngestPatternRule[];
    routineCoordinationPatterns: ResolvedIngestPatternRule[];
    statusOnlyPatterns: ResolvedIngestPatternRule[];
  };
}

export type IngestTaxonomyOperation =
  | IngestTaxonomyAddProjectAliasOperation
  | IngestTaxonomyAddSelfNameOperation
  | IngestTaxonomyAddSlackPatternOperation;

export interface IngestTaxonomyAddProjectAliasOperation {
  kind: "ingest.taxonomy.addProjectAlias";
  label: string;
  aliases: string[];
}

export interface IngestTaxonomyAddSelfNameOperation {
  kind: "ingest.taxonomy.addSelfName";
  name: string;
}

export interface IngestTaxonomyAddSlackPatternOperation {
  kind: "ingest.taxonomy.addSlackPattern";
  field: IngestSlackPatternField;
  rule: IngestPatternRule;
}

export interface IngestTaxonomyApplyResult {
  taxonomy: IngestTaxonomy;
  path: string;
  changed: boolean;
}

export interface IngestTaxonomyProposalApplyResult extends IngestTaxonomyApplyResult {
  proposal: LearningProposalRecord;
}

export interface StageIngestTaxonomyProposalInput {
  operation: IngestTaxonomyOperation;
  reason?: string;
  evidence?: string[];
}

const EMPTY_TAXONOMY: IngestTaxonomy = { version: 1 };

const SLACK_PATTERN_FIELDS = new Set<string>([
  "materialPatterns",
  "ignoredLogPatterns",
  "transientCheckPatterns",
  "routineCoordinationPatterns",
  "statusOnlyPatterns",
]);

export function getIngestTaxonomyPath(repoRoot?: string): string {
  return path.join(getStrataPaths(repoRoot).runtimeDir, "ingest", "taxonomy.json");
}

export function getLegacyIngestProfilePath(repoRoot?: string): string {
  return path.join(getStrataPaths(repoRoot).runtimeDir, "ingest", "profile.json");
}

export async function readIngestTaxonomy(repoRoot?: string): Promise<{
  taxonomy: IngestTaxonomy;
  path: string;
  found: boolean;
  source: "taxonomy" | "legacy-profile" | "empty";
}> {
  const taxonomyPath = getIngestTaxonomyPath(repoRoot);
  const parsed = await readJsonFileOrUndefined<unknown>(taxonomyPath);
  if (parsed !== undefined) {
    return {
      taxonomy: normalizeIngestTaxonomy(parsed, taxonomyPath),
      path: taxonomyPath,
      found: true,
      source: "taxonomy",
    };
  }

  const legacyPath = getLegacyIngestProfilePath(repoRoot);
  const legacy = await readJsonFileOrUndefined<unknown>(legacyPath);
  if (legacy !== undefined) {
    return {
      taxonomy: normalizeIngestTaxonomy(legacy, legacyPath),
      path: legacyPath,
      found: true,
      source: "legacy-profile",
    };
  }

  return { taxonomy: EMPTY_TAXONOMY, path: taxonomyPath, found: false, source: "empty" };
}

export async function writeIngestTaxonomy(
  repoRoot: string | undefined,
  taxonomy: IngestTaxonomy,
): Promise<string> {
  const pathName = getIngestTaxonomyPath(repoRoot);
  await writeJsonFile(pathName, normalizeIngestTaxonomy(taxonomy, pathName));
  return pathName;
}

export async function loadIngestTaxonomy(
  repoRoot?: string,
  override?: IngestTaxonomy,
): Promise<ResolvedIngestTaxonomy> {
  if (override !== undefined) {
    return resolveIngestTaxonomy(override, null, true, "override");
  }

  const read = await readIngestTaxonomy(repoRoot);
  return resolveIngestTaxonomy(
    read.taxonomy,
    read.path,
    read.found,
    read.source === "empty" ? "taxonomy" : read.source,
  );
}

export function resolveIngestTaxonomy(
  value: unknown,
  taxonomyPath: string | null = null,
  found = true,
  source: ResolvedIngestTaxonomy["source"] = "taxonomy",
): ResolvedIngestTaxonomy {
  const taxonomy = normalizeIngestTaxonomy(value, taxonomyPath);

  const projects = (taxonomy.projects ?? []).map((project, index) => {
    const aliases = [project.label, ...(project.aliases ?? [])].map((alias, aliasIndex) =>
      compileResolvedPatternRule(
        { value: alias, match: "literal" },
        `projects[${index}].aliases[${aliasIndex}]`,
      ),
    );
    return {
      label: project.label,
      aliases,
      patterns: aliases.map((alias) => alias.pattern),
    };
  });

  const slack = taxonomy.slack ?? {};
  return {
    path: taxonomyPath,
    found,
    source,
    selfNames: taxonomy.selfNames ?? [],
    projects,
    slack: {
      materialPatterns: patternRules(slack.materialPatterns, "slack.materialPatterns"),
      ignoredLogPatterns: patternRules(slack.ignoredLogPatterns, "slack.ignoredLogPatterns"),
      transientCheckPatterns: patternRules(
        slack.transientCheckPatterns,
        "slack.transientCheckPatterns",
      ),
      routineCoordinationPatterns: patternRules(
        slack.routineCoordinationPatterns,
        "slack.routineCoordinationPatterns",
      ),
      statusOnlyPatterns: patternRules(slack.statusOnlyPatterns, "slack.statusOnlyPatterns"),
    },
  };
}

export function normalizeIngestTaxonomy(
  value: unknown,
  taxonomyPath: string | null = null,
): IngestTaxonomy {
  if (!isObject(value) || value.version !== 1) {
    throw new Error(
      `Invalid ingest taxonomy${taxonomyPath ? ` at ${taxonomyPath}` : ""}: expected version 1 object.`,
    );
  }

  const selfNames = stringArray(value.selfNames, "selfNames");
  const projects = objectArray(value.projects, "projects").map((project, index) => {
    const label = stringField(project.label, `projects[${index}].label`).trim();
    if (label === "") {
      throw new Error(`Invalid ingest taxonomy: projects[${index}].label is required.`);
    }
    const aliases = stringArray(project.aliases, `projects[${index}].aliases`);
    return {
      label,
      ...(aliases.length === 0 ? {} : { aliases }),
    };
  });
  const slack = normalizeSlackTaxonomy(value.slack);
  return {
    version: 1,
    ...(selfNames.length === 0 ? {} : { selfNames }),
    ...(projects.length === 0 ? {} : { projects }),
    ...(Object.keys(slack).length === 0 ? {} : { slack }),
  };
}

export async function addIngestTaxonomyProjectAlias(
  repoRoot: string,
  input: { label: string; aliases: string[] },
): Promise<IngestTaxonomyApplyResult> {
  return updateIngestTaxonomy(repoRoot, (taxonomy) => addProjectAlias(taxonomy, input));
}

export async function addIngestTaxonomySelfName(
  repoRoot: string,
  input: { name: string },
): Promise<IngestTaxonomyApplyResult> {
  return updateIngestTaxonomy(repoRoot, (taxonomy) => addSelfName(taxonomy, input.name));
}

export async function addIngestTaxonomySlackPattern(
  repoRoot: string,
  input: { field: IngestSlackPatternField; rule: IngestPatternRule },
): Promise<IngestTaxonomyApplyResult> {
  return updateIngestTaxonomy(repoRoot, (taxonomy) =>
    addSlackPattern(taxonomy, input.field, input.rule),
  );
}

export async function applyIngestTaxonomyOperation(
  repoRoot: string,
  operation: IngestTaxonomyOperation,
): Promise<IngestTaxonomyApplyResult> {
  switch (operation.kind) {
    case "ingest.taxonomy.addProjectAlias":
      return addIngestTaxonomyProjectAlias(repoRoot, operation);
    case "ingest.taxonomy.addSelfName":
      return addIngestTaxonomySelfName(repoRoot, operation);
    case "ingest.taxonomy.addSlackPattern":
      return addIngestTaxonomySlackPattern(repoRoot, operation);
  }
}

export async function stageIngestTaxonomyProposal(
  repoRoot: string,
  input: StageIngestTaxonomyProposalInput,
): Promise<LearningProposalRecord> {
  const store = await SessionStore.open(repoRoot);
  const title = ingestTaxonomyProposalTitle(input.operation);
  const session = await store.createSession({ kind: "ingest", title });
  try {
    const { proposal, created } = await writeOrReuseLearningProposal(repoRoot, {
      kind: "schema",
      sessionId: session.id,
      title,
      reason:
        input.reason?.trim() ||
        "A reviewed ingest false positive/false negative suggests the local raw-to-wiki taxonomy should be updated before future indexing runs.",
      evidence: input.evidence ?? [],
      proposedChange: formatTaxonomyOperation(input.operation),
      risk: "Low to medium. Taxonomy changes affect future raw-to-wiki classification, so review the pattern scope before applying.",
      applyCommand: `strata ingest taxonomy apply-proposal ${session.id}-schema-${proposalTitleSlug(title)}`,
      dedupeKey: ingestTaxonomyProposalDedupeKey(input.operation),
    });
    await store.appendEvent(session.id, created ? "proposal.created" : "proposal.reused", proposal);
    await store.endSession(session.id, "completed");
    return proposal;
  } catch (error) {
    await store.appendEvent(session.id, "ingest_taxonomy.proposal.failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    await store.endSession(session.id, "failed");
    throw error;
  } finally {
    store.close();
  }
}

export async function applyIngestTaxonomyProposal(
  repoRoot: string,
  input: { selector: string; actor?: string; reason?: string; now?: string },
): Promise<IngestTaxonomyProposalApplyResult> {
  const detail = await readLearningProposal(repoRoot, input.selector);
  if (detail === undefined) {
    throw new Error(`Proposal not found: ${input.selector}`);
  }
  if (detail.proposal.kind !== "schema") {
    throw new Error(`Proposal is not an ingest taxonomy proposal: ${detail.proposal.path}`);
  }
  const operation = parseIngestTaxonomyOperationFromProposal(detail.content);
  const result = await applyIngestTaxonomyOperation(repoRoot, operation);
  const statusInput = {
    selector: detail.proposal.path,
    status: "applied" as const,
    reason:
      input.reason ??
      `${result.changed ? "Applied" : "No-op"} ingest taxonomy update at ${path.relative(
        repoRoot,
        result.path,
      )}.`,
    ...(input.actor === undefined ? {} : { actor: input.actor }),
    ...(input.now === undefined ? {} : { now: input.now }),
  };
  const proposal = await updateLearningProposalStatus(repoRoot, statusInput);
  return { ...result, proposal };
}

export function parseIngestTaxonomyOperationFromProposal(content: string): IngestTaxonomyOperation {
  const match = /```json\s+([\s\S]*?)```/i.exec(content);
  if (match === null) {
    throw new Error("Ingest taxonomy proposal is missing a fenced JSON operation.");
  }
  const parsed = JSON.parse(match[1] ?? "") as unknown;
  return ingestTaxonomyOperationFromUnknown(parsed);
}

async function updateIngestTaxonomy(
  repoRoot: string,
  mutate: (taxonomy: IngestTaxonomy) => { taxonomy: IngestTaxonomy; changed: boolean },
): Promise<IngestTaxonomyApplyResult> {
  const read = await readIngestTaxonomy(repoRoot);
  const next = mutate(read.taxonomy);
  const pathName = await writeIngestTaxonomy(repoRoot, next.taxonomy);
  return { taxonomy: next.taxonomy, path: pathName, changed: next.changed };
}

function addProjectAlias(
  taxonomy: IngestTaxonomy,
  input: { label: string; aliases: string[] },
): { taxonomy: IngestTaxonomy; changed: boolean } {
  const label = cleanRequiredString(input.label, "label");
  const aliases = uniqueStrings(input.aliases);
  if (aliases.length === 0) {
    throw new Error("At least one alias is required.");
  }

  const projects = [...(taxonomy.projects ?? [])];
  const existingIndex = projects.findIndex((project) => sameText(project.label, label));
  let changed = false;
  if (existingIndex === -1) {
    projects.push({ label, aliases });
    changed = true;
  } else {
    const current = projects[existingIndex];
    if (current === undefined) {
      throw new Error(`Could not update project alias for ${label}.`);
    }
    const nextAliases = uniqueStrings([...(current.aliases ?? []), ...aliases]);
    changed = nextAliases.length !== (current.aliases ?? []).length;
    projects[existingIndex] = {
      label: current.label,
      ...(nextAliases.length ? { aliases: nextAliases } : {}),
    };
  }

  return {
    taxonomy: normalizeIngestTaxonomy({ ...taxonomy, projects }),
    changed,
  };
}

function addSelfName(
  taxonomy: IngestTaxonomy,
  value: string,
): { taxonomy: IngestTaxonomy; changed: boolean } {
  const name = cleanRequiredString(value, "name");
  const selfNames = uniqueStrings([...(taxonomy.selfNames ?? []), name]);
  return {
    taxonomy: normalizeIngestTaxonomy({ ...taxonomy, selfNames }),
    changed: selfNames.length !== (taxonomy.selfNames ?? []).length,
  };
}

function addSlackPattern(
  taxonomy: IngestTaxonomy,
  field: IngestSlackPatternField,
  inputRule: IngestPatternRule,
): { taxonomy: IngestTaxonomy; changed: boolean } {
  assertSlackPatternField(field);
  const rule = normalizePatternRule(inputRule, `slack.${field}`);
  const slack = taxonomy.slack ?? {};
  const existing = slack[field] ?? [];
  const nextRules = dedupePatternRules([...existing, rule]);
  const nextSlack = { ...slack, [field]: nextRules };
  return {
    taxonomy: normalizeIngestTaxonomy({ ...taxonomy, slack: nextSlack }),
    changed: nextRules.length !== existing.length,
  };
}

function normalizeSlackTaxonomy(value: unknown): IngestSlackTaxonomy {
  if (value === undefined) {
    return {};
  }
  if (!isObject(value)) {
    throw new Error("Invalid ingest taxonomy: slack must be an object.");
  }
  return {
    ...normalizeOptionalPatternRules(value.materialPatterns, "slack.materialPatterns"),
    ...normalizeOptionalPatternRules(value.ignoredLogPatterns, "slack.ignoredLogPatterns"),
    ...normalizeOptionalPatternRules(value.transientCheckPatterns, "slack.transientCheckPatterns"),
    ...normalizeOptionalPatternRules(
      value.routineCoordinationPatterns,
      "slack.routineCoordinationPatterns",
    ),
    ...normalizeOptionalPatternRules(value.statusOnlyPatterns, "slack.statusOnlyPatterns"),
  };
}

function normalizeOptionalPatternRules(
  value: unknown,
  field: string,
): Partial<IngestSlackTaxonomy> {
  const rules = patternRulesInput(value, field);
  if (rules.length === 0) {
    return {};
  }
  const key = field.split(".").at(-1);
  if (key === undefined || !SLACK_PATTERN_FIELDS.has(key)) {
    throw new Error(`Invalid ingest taxonomy field: ${field}`);
  }
  return { [key]: rules };
}

function patternRules(value: unknown, field: string): ResolvedIngestPatternRule[] {
  return patternRulesInput(value, field).map((item, index) =>
    compileResolvedPatternRule(item, `${field}[${index}]`),
  );
}

function patternRulesInput(value: unknown, field: string): IngestPatternRule[] {
  return objectArray(value, field).map((item, index) =>
    normalizePatternRule(item, `${field}[${index}]`),
  );
}

function normalizePatternRule(value: unknown, field: string): IngestPatternRule {
  if (!isObject(value)) {
    throw new Error(`Invalid ingest taxonomy: ${field} must be an object.`);
  }
  const ruleValue = stringField(value.value, `${field}.value`).trim();
  if (ruleValue === "") {
    throw new Error(`Invalid ingest taxonomy: ${field}.value is required.`);
  }
  const match = value.match === undefined ? "literal" : value.match;
  if (match !== "literal" && match !== "regex") {
    throw new Error(`Invalid ingest taxonomy: ${field}.match must be "literal" or "regex".`);
  }
  const flags = value.flags === undefined ? undefined : stringField(value.flags, `${field}.flags`);
  if (flags !== undefined) {
    sanitizeFlags(flags, field);
  }
  const reason =
    typeof value.reason === "string" && value.reason.trim() !== "" ? value.reason.trim() : "";
  return {
    value: ruleValue,
    match,
    ...(flags === undefined ? {} : { flags }),
    ...(reason === "" ? {} : { reason }),
  };
}

function compileResolvedPatternRule(
  rule: IngestPatternRule,
  field: string,
): ResolvedIngestPatternRule {
  const match = rule.match ?? "literal";
  const flags = sanitizeFlags(rule.flags ?? "i", field);
  const pattern =
    match === "regex"
      ? compileRegex(rule.value, flags, field)
      : new RegExp(escapeRegExp(rule.value), flags);
  return {
    pattern,
    value: rule.value,
    match,
    flags,
    reason: rule.reason?.trim() || null,
    source: "taxonomy",
    field,
  };
}

function compileRegex(value: string, flags: string, field: string): RegExp {
  try {
    return new RegExp(value, flags);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid ingest taxonomy regex at ${field}: ${message}`);
  }
}

function sanitizeFlags(value: string, field: string): string {
  const flags = [...new Set(value.replace(/[gy]/g, "").split(""))].join("");
  if (!/^[dimsuv]*$/.test(flags)) {
    throw new Error(`Invalid ingest taxonomy regex flags at ${field}: ${value}`);
  }
  return flags || "i";
}

function ingestTaxonomyOperationFromUnknown(value: unknown): IngestTaxonomyOperation {
  if (!isObject(value) || typeof value.kind !== "string") {
    throw new Error("Ingest taxonomy operation must be an object with a kind.");
  }
  if (value.kind === "ingest.taxonomy.addProjectAlias") {
    return {
      kind: value.kind,
      label: cleanRequiredString(value.label, "label"),
      aliases: stringArray(value.aliases, "aliases"),
    };
  }
  if (value.kind === "ingest.taxonomy.addSelfName") {
    return {
      kind: value.kind,
      name: cleanRequiredString(value.name, "name"),
    };
  }
  if (value.kind === "ingest.taxonomy.addSlackPattern") {
    if (typeof value.field !== "string") {
      throw new Error("field is required.");
    }
    assertSlackPatternField(value.field);
    if (!isObject(value.rule)) {
      throw new Error("rule is required.");
    }
    return {
      kind: value.kind,
      field: value.field,
      rule: normalizePatternRule(value.rule, `slack.${value.field}`),
    };
  }
  throw new Error(`Unsupported ingest taxonomy operation: ${value.kind}`);
}

function formatTaxonomyOperation(operation: IngestTaxonomyOperation): string {
  return [
    "Apply this reviewed local taxonomy operation:",
    "",
    "```json",
    JSON.stringify(operation, null, 2),
    "```",
  ].join("\n");
}

function ingestTaxonomyProposalTitle(operation: IngestTaxonomyOperation): string {
  if (operation.kind === "ingest.taxonomy.addProjectAlias") {
    return `Update ingest taxonomy: add aliases for ${operation.label}`;
  }
  if (operation.kind === "ingest.taxonomy.addSelfName") {
    return `Update ingest taxonomy: add self name ${operation.name}`;
  }
  return `Update ingest taxonomy: add Slack ${operation.field} pattern`;
}

function ingestTaxonomyProposalDedupeKey(operation: IngestTaxonomyOperation): string {
  if (operation.kind === "ingest.taxonomy.addProjectAlias") {
    return `ingest-taxonomy:project:${normalizeKey(operation.label)}:${operation.aliases
      .map(normalizeKey)
      .sort()
      .join(",")}`;
  }
  if (operation.kind === "ingest.taxonomy.addSelfName") {
    return `ingest-taxonomy:self:${normalizeKey(operation.name)}`;
  }
  return `ingest-taxonomy:slack:${operation.field}:${normalizeKey(operation.rule.value)}`;
}

function proposalTitleSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function assertSlackPatternField(value: string): asserts value is IngestSlackPatternField {
  if (!SLACK_PATTERN_FIELDS.has(value)) {
    throw new Error(
      "Slack pattern field must be one of: materialPatterns, ignoredLogPatterns, transientCheckPatterns, routineCoordinationPatterns, statusOnlyPatterns",
    );
  }
}

function dedupePatternRules(rules: IngestPatternRule[]): IngestPatternRule[] {
  const seen = new Set<string>();
  const result: IngestPatternRule[] = [];
  for (const rule of rules) {
    const key = `${rule.match ?? "literal"}:${rule.flags ?? "i"}:${rule.value.toLowerCase()}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(rule);
  }
  return result;
}

function objectArray(value: unknown, field: string): Record<string, unknown>[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`Invalid ingest taxonomy: ${field} must be an array.`);
  }
  return value.map((item, index) => {
    if (!isObject(item)) {
      throw new Error(`Invalid ingest taxonomy: ${field}[${index}] must be an object.`);
    }
    return item;
  });
}

function stringArray(value: unknown, field: string): string[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`Invalid ingest taxonomy: ${field} must be an array.`);
  }
  return uniqueStrings(
    value.map((item, index) => stringField(item, `${field}[${index}]`).trim()).filter(Boolean),
  );
}

function stringField(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new Error(`Invalid ingest taxonomy: ${field} must be a string.`);
  }
  return value;
}

function cleanRequiredString(value: unknown, field: string): string {
  const text = stringField(value, field).trim();
  if (text === "") {
    throw new Error(`${field} is required.`);
  }
  return text;
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

function sameText(left: string, right: string): boolean {
  return normalizeKey(left) === normalizeKey(right);
}

function normalizeKey(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Compatibility names for callers from the previous implementation pass.
export type IngestProfile = IngestTaxonomy;
export type ResolvedIngestProfile = ResolvedIngestTaxonomy;
export type IngestSlackProfile = IngestSlackTaxonomy;
export const getIngestProfilePath = getLegacyIngestProfilePath;
export const loadIngestProfile = loadIngestTaxonomy;
export const resolveIngestProfile = resolveIngestTaxonomy;
