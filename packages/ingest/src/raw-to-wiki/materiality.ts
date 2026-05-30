import type { ResolvedIngestPatternRule, ResolvedIngestTaxonomy } from "../ingestTaxonomy.js";
import { decisionCandidateLines } from "./extraction.js";
import type { ClassificationReason, RawFrontmatter } from "./types.js";

interface PatternRule {
  pattern: RegExp;
  label: string;
  source: "generic" | "taxonomy";
  reason: string | null;
}

export interface SlackMaterialityInput {
  body: string;
  messages: string[];
  parsed: RawFrontmatter;
  title: string;
  taxonomy: ResolvedIngestTaxonomy;
}

export type SlackMaterialityResult =
  | { material: true; classificationReasons: ClassificationReason[] }
  | { material: false; reason: string; classificationReasons: ClassificationReason[] };

const GENERIC_SLACK_MATERIAL_PATTERNS = [
  /\?/,
  /\b(can you|could you|please|i'd like|i would like|i want|we need|need help|let's|lets)\b/i,
  /\b(add|remove|update|migrate|fix|debug|investigate|look at|take a look|make)\b/i,
  /\b(what happened|why|how do|should we|do we know|is it possible|question)\b/i,
  /\b(decision|agreed|decided|approved|we will|going forward|the plan is)\b/i,
  /\b(severity|root cause|incident|task|pull request|pr|security|bug|error)\b/i,
];

export function slackMateriality(input: SlackMaterialityInput): SlackMaterialityResult {
  const meaningfulMessages = input.messages.filter(isMeaningfulSlackMessage);
  if (meaningfulMessages.length === 0) {
    return {
      material: false,
      reason: "Slack thread contains no message text.",
      classificationReasons: [],
    };
  }

  const combined = normalizeSlackText([input.title, ...meaningfulMessages.slice(0, 12)].join("\n"));
  const signalCombined = slackSignalText(combined);
  const nonLogCombined = slackSignalText(
    meaningfulMessages
      .filter((message) => !looksLikeSlackLogMessage(message, input.taxonomy))
      .filter((message) => !isSlackStatusOnlyMessage(message, input.taxonomy))
      .join("\n"),
  );
  const decisionCandidates = decisionCandidateLines(signalCombined, 1);
  const materialRules = [
    ...genericRules(GENERIC_SLACK_MATERIAL_PATTERNS, "material signal"),
    ...taxonomyRules(input.taxonomy.slack.materialPatterns),
  ];
  const materialRule = firstMatchingPattern(signalCombined, materialRules);
  const nonLogMaterialRule =
    nonLogCombined === "" ? null : firstMatchingPattern(nonLogCombined, materialRules);
  const materialReasons = [
    ...(materialRule === null ? [] : [patternReason(materialRule, "slack_material_signal")]),
    ...decisionCandidates.slice(0, 1).map((candidate) => ({
      kind: "slack_material_signal" as const,
      source: "generic" as const,
      label: "decision candidate",
      matchedText: candidate.text,
    })),
  ];
  const hasMaterialSignal = materialReasons.length > 0;
  const hasNonLogMaterialSignal = nonLogMaterialRule !== null;
  const ignoredLogRule = firstMatchingPattern(
    combined,
    taxonomyRules(input.taxonomy.slack.ignoredLogPatterns),
  );
  const statusOnly = meaningfulMessages.every((message) =>
    isSlackStatusOnlyMessage(message, input.taxonomy),
  );
  const linkOnly = isSlackLinkOnlyThread(input.title, meaningfulMessages);

  const transientRule = taxonomyBoundedThreadMatch(
    input.title,
    meaningfulMessages,
    input.taxonomy.slack.transientCheckPatterns,
  );
  if (transientRule !== null) {
    return {
      material: false,
      reason: transientRule.reason ?? "Slack thread is a transient support/status check.",
      classificationReasons: [patternReason(transientRule, "slack_low_signal")],
    };
  }

  const coordinationRule = taxonomyBoundedThreadMatch(
    input.title,
    meaningfulMessages,
    input.taxonomy.slack.routineCoordinationPatterns,
  );
  if (coordinationRule !== null) {
    return {
      material: false,
      reason: coordinationRule.reason ?? "Slack thread is a routine coordination check.",
      classificationReasons: [patternReason(coordinationRule, "slack_low_signal")],
    };
  }
  if (ignoredLogRule !== null && !hasNonLogMaterialSignal) {
    return {
      material: false,
      reason: ignoredLogRule.reason ?? "Slack thread appears to be an automation/log notification.",
      classificationReasons: [patternReason(ignoredLogRule, "slack_low_signal")],
    };
  }
  if (statusOnly && !hasMaterialSignal) {
    return {
      material: false,
      reason: "Slack thread only contains routine status/progress updates.",
      classificationReasons: [
        {
          kind: "slack_low_signal",
          source: "generic",
          label: "status-only message",
        },
      ],
    };
  }
  if (linkOnly) {
    return {
      material: false,
      reason: "Slack thread only contains links and no material context.",
      classificationReasons: [
        {
          kind: "slack_low_signal",
          source: "generic",
          label: "link-only thread",
        },
      ],
    };
  }
  if (!hasMaterialSignal) {
    return {
      material: false,
      reason: "Slack thread has no material ask, decision, action, incident, or project signal.",
      classificationReasons: [],
    };
  }

  return { material: true, classificationReasons: materialReasons };
}

export function slackSummary(
  messages: string[],
  title: string,
  taxonomy: ResolvedIngestTaxonomy,
): string {
  const selected = messages
    .filter(isMeaningfulSlackMessage)
    .filter((message) => !isSlackStatusOnlyMessage(message, taxonomy))
    .slice(0, 8);
  if (selected.length === 0) {
    return `- ${title}`;
  }
  return selected.map((message) => `- ${message}`).join("\n");
}

export function normalizeSlackText(value: string): string {
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

function taxonomyBoundedThreadMatch(
  title: string,
  messages: string[],
  rules: ResolvedIngestPatternRule[],
): PatternRule | null {
  if (rules.length === 0 || messages.length > 2) {
    return null;
  }
  const text = uniqueStrings(messages).join(" ").trim() || title;
  const combined = slackSignalText(text).toLowerCase();
  if (combined.length > 260) {
    return null;
  }
  return firstMatchingPattern(combined, taxonomyRules(rules));
}

function firstMatchingPattern(value: string, rules: PatternRule[]): PatternRule | null {
  return rules.find((rule) => rule.pattern.test(value)) ?? null;
}

function isMeaningfulSlackMessage(message: string): boolean {
  const normalized = normalizeSlackText(message);
  if (normalized === "" || /^_?no text_?$/i.test(normalized)) {
    return false;
  }
  return !/^reactions?:/i.test(normalized);
}

function isSlackStatusOnlyMessage(message: string, taxonomy: ResolvedIngestTaxonomy): boolean {
  const normalized = normalizeSlackText(message).toLowerCase();
  return (
    /^_?no text_?$/.test(normalized) ||
    /^getting started on your task\b/.test(normalized) ||
    /^i'?m (looking|pulling|running|checking|working|letting|in the final|going)\b/.test(
      normalized,
    ) ||
    /^(?:ok|okay|sure),?\s+(?:i(?:'ll| will)\s+)?(?:have|take) a look\b/.test(normalized) ||
    /^done\b/.test(normalized) ||
    firstMatchingPattern(normalized, taxonomyRules(taxonomy.slack.statusOnlyPatterns)) !== null
  );
}

function looksLikeSlackLogMessage(message: string, taxonomy: ResolvedIngestTaxonomy): boolean {
  const normalized = normalizeSlackText(message).toLowerCase();
  return (
    firstMatchingPattern(normalized, taxonomyRules(taxonomy.slack.ignoredLogPatterns)) !== null
  );
}

function genericRules(patterns: RegExp[], label: string): PatternRule[] {
  return patterns.map((pattern) => ({
    pattern,
    label,
    source: "generic" as const,
    reason: null,
  }));
}

function taxonomyRules(rules: ResolvedIngestPatternRule[]): PatternRule[] {
  return rules.map((rule) => ({
    pattern: rule.pattern,
    label: rule.value,
    source: "taxonomy" as const,
    reason: rule.reason,
  }));
}

function patternReason(
  rule: PatternRule,
  kind: "slack_low_signal" | "slack_material_signal",
): ClassificationReason {
  return {
    kind,
    source: rule.source,
    label: rule.label,
    ...(rule.reason === null ? {} : { reason: rule.reason }),
  };
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
