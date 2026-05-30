import { TAXONOMY_SUGGESTIONS_OUTPUT_SCHEMA } from "@strata/ingest/taxonomy-suggestions";
import { type CreateRoutineInput, RoutineStore } from "@strata/routines";

export const TAXONOMY_SUGGESTIONS_ROUTINE_ID = "routine_taxonomy_suggestions";
const TAXONOMY_EVIDENCE_JOB_NAME = "ingest.taxonomy.evidence";

const TAXONOMY_SUGGESTIONS_PROMPT = `You curate the local ingest taxonomy — the vocabulary that teaches raw-to-wiki ingestion how to read this workspace (projects and their aliases, the user's self-names, and Slack noise patterns).

Your task: from the prepared evidence, propose precise taxonomy operations that would let future ingestion classify these sources correctly. These become reviewable proposals — a human approves them. You never apply anything directly.

The evidence is in the pre-run job output above, under its \`details\` field: an evidence bundle with \`candidates\` (raw-to-wiki outcomes the generic classifier could not attribute to a known project) and \`taxonomy\` (a summary of vocabulary that already exists). Each candidate has a \`rawPath\`, \`primaryPath\`, \`source\`, \`title\`, \`reviewReason\`, and the \`projectPaths\` the generic classifier guessed.

How to work:
- Read the actual source files with fs.read or wiki.retrieve before proposing — confirm the vocabulary really appears and recurs. Do not guess from titles alone.
- Trust clean structured sources (Granola, Notion) far more than Slack. Slack candidates are already capped; be conservative — only propose Slack-derived vocabulary that clearly and repeatedly names a real project.
- Never re-propose anything already present: skip any label already in \`taxonomy.projectLabels\`, and skip self-names/patterns the taxonomy already has.

What to propose (only when genuinely warranted):
- A recurring real project the taxonomy is missing -> \`ingest.taxonomy.addProjectAlias\` with the canonical \`label\` and the surface \`aliases\` you actually saw.
- The user themselves being misread as a project or topic -> \`ingest.taxonomy.addSelfName\` (only if it is clearly the user).
- Obvious recurring Slack chatter that should not be indexed at all -> \`ingest.taxonomy.addSlackPattern\` on \`ignoredLogPatterns\`.

For every suggestion give a one-sentence \`rationale\`, a \`confidence\` from 0 to 1, and \`sourceRefs\` citing the candidate \`rawPath\`(s) that justify it.

When done, call routine.output.submit exactly once with { "suggestions": [ ... ] }. If nothing is worth proposing, submit { "suggestions": [] }. Prefer proposing nothing over proposing noise.`;

/** The seedable taxonomy-suggestion Routine (docs/taxonomy-suggestion-plan.md, Slice 2). */
function taxonomySuggestionsRoutineDefinition(): CreateRoutineInput {
  return {
    id: TAXONOMY_SUGGESTIONS_ROUTINE_ID,
    name: "Taxonomy suggestions",
    description:
      "Propose ingest-taxonomy vocabulary from review-queue evidence, staged as reviewable schema proposals.",
    status: "enabled",
    prompt: TAXONOMY_SUGGESTIONS_PROMPT,
    inputSchema: { type: "object" },
    defaultInput: {},
    outputSchema: TAXONOMY_SUGGESTIONS_OUTPUT_SCHEMA,
    // Optional: a clean run can legitimately propose nothing.
    outputMode: "optional",
    toolProfile: "learning",
    requiredSkills: [],
    preRunSteps: [{ jobName: TAXONOMY_EVIDENCE_JOB_NAME, input: {} }],
    publicationPolicy: { mode: "proposal", proposalKind: "schema" },
  };
}

/**
 * Idempotently ensure the taxonomy-suggestion Routine exists. Returns true when
 * it was created this call. Definition drift (prompt/schema edits) is left to an
 * explicit update so a reviewer's local customizations are never silently
 * overwritten by a job run.
 */
export function ensureTaxonomySuggestionsRoutine(store: RoutineStore): boolean {
  if (store.getRoutine(TAXONOMY_SUGGESTIONS_ROUTINE_ID) !== null) {
    return false;
  }
  store.createRoutine(taxonomySuggestionsRoutineDefinition());
  return true;
}
