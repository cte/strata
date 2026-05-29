import type { JsonObject } from "@strata/core";

export interface CandidateLine {
  line: number;
  text: string;
}

export type ClassificationReasonKind =
  | "project_alias"
  | "self_name"
  | "slack_material_signal"
  | "slack_low_signal";

export interface ClassificationReason extends JsonObject {
  kind: ClassificationReasonKind;
  source: "generic" | "taxonomy";
  label: string;
  matchedText?: string;
  reason?: string;
}

export interface RawFrontmatter {
  scalars: Record<string, string>;
  arrays: Record<string, string[]>;
}
