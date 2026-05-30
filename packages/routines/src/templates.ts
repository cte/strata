import type { CreateRoutineInput, RoutinePreRunStep } from "./types.js";

/**
 * Built-in Routine templates for the common infrastructure automations that
 * used to be raw Schedules (connector pulls, index refresh, wiki hygiene).
 * Each does its real work in `preRunSteps` (deterministic, guaranteed) and runs
 * a `read-only` agent with a one-line prompt — so the mandatory agent step is
 * cheap and harmless. "New Routine → From template" instantiates one into a
 * normal, editable Routine (a fresh id is generated; the template is not a
 * standing system object). See ADR-0002.
 */

export interface RoutineTemplate {
  key: string;
  label: string;
  /** Definition minus identity — the store generates an id at instantiation. */
  definition: Omit<CreateRoutineInput, "id" | "now">;
}

const NO_ACTION_PROMPT =
  "The pre-run steps refreshed local data. There is nothing further to do — confirm and finish.";

function infraTemplate(args: {
  key: string;
  label: string;
  name: string;
  description: string;
  preRunSteps: RoutinePreRunStep[];
}): RoutineTemplate {
  return {
    key: args.key,
    label: args.label,
    definition: {
      name: args.name,
      description: args.description,
      status: "disabled",
      prompt: NO_ACTION_PROMPT,
      inputSchema: { type: "object" },
      defaultInput: {},
      outputSchema: null,
      outputMode: "none",
      toolProfile: "read-only",
      requiredSkills: [],
      preRunSteps: args.preRunSteps,
      publicationPolicy: { mode: "artifact_only" },
    },
  };
}

const TEMPLATES: RoutineTemplate[] = [
  infraTemplate({
    key: "granola-sync",
    label: "Granola sync",
    name: "Granola sync",
    description: "Pull recent Granola meeting notes into the wiki and refresh retrieval.",
    preRunSteps: [
      {
        jobName: "connector.pull",
        input: { connector: "granola", operation: "pull", index: true, refreshSearchIndex: true },
      },
    ],
  }),
  infraTemplate({
    key: "slack-sync",
    label: "Slack sync",
    name: "Slack sync",
    description: "Checkpoint Slack history, save material threads, and refresh retrieval.",
    preRunSteps: [
      {
        jobName: "connector.pull",
        input: { connector: "slack", operation: "pull", index: true, refreshSearchIndex: true },
      },
    ],
  }),
  infraTemplate({
    key: "index-refresh",
    label: "Index refresh",
    name: "Index refresh",
    description: "Rebuild the local retrieval index from the current wiki.",
    preRunSteps: [
      { jobName: "wiki.search-index.refresh", input: { source: "all", includeRaw: true } },
    ],
  }),
  infraTemplate({
    key: "wiki-hygiene",
    label: "Wiki hygiene",
    name: "Wiki hygiene",
    description: "Stage entity-consolidation proposals and refresh retrieval.",
    preRunSteps: [
      { jobName: "wiki.hygiene", input: { refreshSearchIndex: true, includeRaw: true } },
    ],
  }),
];

export function listRoutineTemplates(): RoutineTemplate[] {
  return TEMPLATES.map((template) => ({ ...template }));
}

export function getRoutineTemplate(key: string): RoutineTemplate | null {
  return TEMPLATES.find((template) => template.key === key) ?? null;
}

/** The `CreateRoutineInput` for a template, ready to pass to `RoutineStore.createRoutine`. */
export function routineTemplateInput(key: string): CreateRoutineInput | null {
  const template = getRoutineTemplate(key);
  return template === null ? null : { ...template.definition };
}
