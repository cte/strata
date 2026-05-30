import type { ResolvedIngestTaxonomy } from "../ingestTaxonomy.js";
import type { ClassificationReason } from "./types.js";

export interface ProjectLabelMatchResult {
  labels: string[];
  reasons: ClassificationReason[];
}

export function projectLabelsFromTaxonomyText(
  text: string,
  taxonomy: ResolvedIngestTaxonomy,
): ProjectLabelMatchResult {
  const labels: string[] = [];
  const reasons: ClassificationReason[] = [];
  for (const rule of taxonomy.projects) {
    const alias = rule.aliases.find((candidate) => candidate.pattern.test(text));
    if (alias === undefined) {
      continue;
    }
    labels.push(rule.label);
    reasons.push({
      kind: "project_alias",
      source: "taxonomy",
      label: rule.label,
      matchedText: alias.value,
      ...(alias.reason === null ? {} : { reason: alias.reason }),
    });
  }
  return {
    labels: uniqueStrings(labels),
    reasons: uniqueReasons(reasons),
  };
}

export function canonicalProjectLabelForText(
  text: string,
  taxonomy: ResolvedIngestTaxonomy,
): string | null {
  return (
    taxonomy.projects.find((rule) => rule.aliases.some((alias) => alias.pattern.test(text)))
      ?.label ?? null
  );
}

export function normalizeProjectLabels(
  labels: string[],
  taxonomy: ResolvedIngestTaxonomy,
): string[] {
  return uniqueStrings(
    labels.map((label) => canonicalProjectLabelForText(label, taxonomy) ?? label),
  );
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

function uniqueReasons(reasons: ClassificationReason[]): ClassificationReason[] {
  const seen = new Set<string>();
  const result: ClassificationReason[] = [];
  for (const reason of reasons) {
    const key = `${reason.kind}:${reason.source}:${reason.label}:${reason.matchedText ?? ""}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(reason);
  }
  return result;
}
