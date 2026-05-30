import {
  type CreateModelAdapterOptions,
  createModelAdapter,
  type ModelAdapter,
  type ModelProviderName,
  THINKING_LEVELS,
  type ThinkingLevel,
} from "@strata/agent";
import { runMaintenanceJob } from "@strata/agent/maintenance";
import { type JsonObject, type JsonValue, refreshWikiSearchIndex } from "@strata/core";
import type { ConnectorConfig, ConnectorName } from "@strata/ingest/connector-types";
import { runConnectorWorkflow } from "@strata/ingest/connectors";
import { stageIngestTaxonomyProposal } from "@strata/ingest/ingest-taxonomy";
import { type RawToWikiSourceFilter, runRawToWikiIndex } from "@strata/ingest/raw-to-wiki";
import { buildTaxonomyEvidenceFromStore } from "@strata/ingest/taxonomy-evidence";
import { suggestionsToProposalInputs } from "@strata/ingest/taxonomy-suggestions";
import { RoutineStore, runRoutine } from "@strata/routines";
import {
  ensureTaxonomySuggestionsRoutine,
  TAXONOMY_SUGGESTIONS_ROUTINE_ID,
} from "./taxonomySuggestionRoutine.js";
import type { JobDefinition } from "./types.js";

export interface DefaultJobDefinitionsOptions {
  createModelAdapter?: (options: CreateModelAdapterOptions) => Promise<ModelAdapter>;
}

type ConnectorPullJobInput = JsonObject & {
  connector?: JsonValue;
  operation?: JsonValue;
  config?: JsonValue;
  configProfileId?: JsonValue;
  index?: JsonValue;
  refreshSearchIndex?: JsonValue;
  lookbackMinutes?: JsonValue;
  title?: JsonValue;
};

type MaintenanceJobInput = JsonObject & {
  jobName?: JsonValue;
};

type RawIndexJobInput = JsonObject & {
  source?: JsonValue;
  rawPaths?: JsonValue;
  limit?: JsonValue;
  dryRun?: JsonValue;
};

type SearchIndexJobInput = JsonObject & {
  source?: JsonValue;
  includeRaw?: JsonValue;
};

type WikiHygieneJobInput = JsonObject & {
  refreshSearchIndex?: JsonValue;
  includeRaw?: JsonValue;
};

type RoutineRunJobInput = JsonObject & {
  routineId?: JsonValue;
  input?: JsonValue;
  provider?: JsonValue;
  model?: JsonValue;
  reasoningEffort?: JsonValue;
};

type TaxonomyEvidenceJobInput = JsonObject & {
  structuredCap?: JsonValue;
  slackCap?: JsonValue;
  scanLimit?: JsonValue;
};

type TaxonomySuggestJobInput = JsonObject & {
  provider?: JsonValue;
  model?: JsonValue;
  reasoningEffort?: JsonValue;
  minConfidence?: JsonValue;
};

const CONNECTOR_NAMES = new Set(["granola", "notion", "slack"]);
const RAW_INDEX_SOURCES = new Set(["all", "granola", "notion", "slack"]);
const MODEL_PROVIDERS = new Set(["openai-codex", "openai-compatible", "anthropic-claude"]);

export function defaultJobDefinitions(options: DefaultJobDefinitionsOptions = {}): JobDefinition[] {
  return [
    routineRunJob(options),
    maintenanceRunJob(),
    connectorPullJob(),
    rawIndexJob(),
    wikiSearchIndexRefreshJob(),
    wikiHygieneJob(),
    taxonomyEvidenceJob(),
    taxonomySuggestJob(),
  ];
}

function routineRunJob(options: DefaultJobDefinitionsOptions): JobDefinition<RoutineRunJobInput> {
  return {
    name: "routine.run",
    description: "Run a saved Routine with structured input and trace-backed child sessions.",
    mode: "write",
    defaultConcurrency: "skip",
    inputSchema: {
      type: "object",
      required: ["routineId"],
      properties: {
        routineId: {
          type: "string",
          description: "Routine id to execute.",
        },
        input: {
          type: "object",
          description: "Structured routine input merged over the routine default input.",
          default: {},
        },
        provider: {
          type: "string",
          enum: ["openai-codex", "openai-compatible", "anthropic-claude"],
        },
        model: { type: "string" },
        reasoningEffort: {
          type: "string",
          enum: [...THINKING_LEVELS],
        },
      },
    },
    async run(input, context) {
      const routineId = stringField(input.routineId, "routineId");
      const routineInput = jsonObjectField(input.input, "input");
      const provider = optionalModelProvider(input.provider);
      const modelName = optionalString(input.model, "model");
      const reasoningEffort = optionalThinkingLevel(input.reasoningEffort);
      const result = await runRoutine({
        routineId,
        input: routineInput,
        repoRoot: context.repoRoot,
        env: context.env,
        now: context.now,
        jobSessionId: context.sessionId,
        createModelAdapter: options.createModelAdapter ?? createModelAdapter,
        runPreRunJob: async (childInput) =>
          context.runJob({
            jobName: childInput.jobName,
            input: childInput.input,
            ...(childInput.title === undefined ? {} : { title: childInput.title }),
          }),
        ...(provider === undefined ? {} : { provider }),
        ...(modelName === undefined ? {} : { model: modelName }),
        ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
      });
      return {
        status: result.status,
        summary: result.summary,
        metrics: {
          routineId: result.routineId,
          routineRunId: result.routineRunId,
          routineVersion: result.routineVersion,
          taskStatus: result.taskStatus,
          agentSessionId: result.agentSessionId,
          childSessionIds: result.childSessionIds,
          outputArtifactIds: result.outputArtifactIds,
          agentStatus: result.agentStatus,
          stoppedReason: result.stoppedReason,
          iterations: result.iterations,
          toolCalls: result.toolCalls,
        },
        details: result,
      };
    },
  };
}

function taxonomyEvidenceJob(): JobDefinition<TaxonomyEvidenceJobInput> {
  return {
    name: "ingest.taxonomy.evidence",
    description:
      "Build the source-weighted, Slack-bounded taxonomy evidence bundle from the review queue.",
    mode: "read",
    defaultConcurrency: "skip",
    inputSchema: {
      type: "object",
      properties: {
        structuredCap: { type: "number", description: "Max Granola/Notion candidates." },
        slackCap: { type: "number", description: "Max Slack candidates (noise floor)." },
        scanLimit: { type: "number", description: "Review-queue candidates to consider." },
      },
    },
    async run(input, context) {
      const structuredCap = optionalPositiveNumber(input.structuredCap, "structuredCap");
      const slackCap = optionalPositiveNumber(input.slackCap, "slackCap");
      const scanLimit = optionalPositiveNumber(input.scanLimit, "scanLimit");
      const bundle = await buildTaxonomyEvidenceFromStore({
        repoRoot: context.repoRoot,
        ...(structuredCap === undefined ? {} : { structuredCap }),
        ...(slackCap === undefined ? {} : { slackCap }),
        ...(scanLimit === undefined ? {} : { scanLimit }),
      });
      return {
        status: "ok",
        summary: `${bundle.counts.candidates} candidate${bundle.counts.candidates === 1 ? "" : "s"} (${bundle.counts.structured} structured, ${bundle.counts.slack} slack; ${bundle.counts.droppedSlack} slack dropped).`,
        metrics: {
          candidates: bundle.counts.candidates,
          structured: bundle.counts.structured,
          slack: bundle.counts.slack,
          droppedSlack: bundle.counts.droppedSlack,
        },
        details: asJsonValue(bundle),
      };
    },
  };
}

function taxonomySuggestJob(): JobDefinition<TaxonomySuggestJobInput> {
  return {
    name: "ingest.taxonomy.suggest",
    description:
      "Run the taxonomy-suggestion Routine and stage its proposals as reviewable schema proposals.",
    mode: "write",
    defaultConcurrency: "skip",
    inputSchema: {
      type: "object",
      properties: {
        provider: {
          type: "string",
          enum: ["openai-codex", "openai-compatible", "anthropic-claude"],
        },
        model: { type: "string" },
        reasoningEffort: { type: "string", enum: [...THINKING_LEVELS] },
        minConfidence: {
          type: "number",
          description: "Drop suggestions below this confidence before staging (default 0).",
        },
      },
    },
    async run(input, context) {
      const minConfidence = optionalPositiveNumber(input.minConfidence, "minConfidence") ?? 0;

      // Seed the Routine on first run so the suggester is self-installing.
      const seedStore = await RoutineStore.open({ repoRoot: context.repoRoot });
      try {
        ensureTaxonomySuggestionsRoutine(seedStore);
      } finally {
        seedStore.close();
      }

      // Run the Routine through the shared routine.run job so pre-run evidence,
      // model wiring, and trace lineage stay consistent with every other Routine.
      const provider = optionalModelProvider(input.provider);
      const modelName = optionalString(input.model, "model");
      const reasoningEffort = optionalThinkingLevel(input.reasoningEffort);
      const routineInput: JsonObject = {
        routineId: TAXONOMY_SUGGESTIONS_ROUTINE_ID,
        ...(provider === undefined ? {} : { provider }),
        ...(modelName === undefined ? {} : { model: modelName }),
        ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
      };
      const child = await context.runJob({
        jobName: "routine.run",
        input: routineInput,
        title: "Taxonomy suggestions",
      });
      if (child.status === "failed") {
        return {
          status: "needs_attention",
          summary: `Taxonomy suggestion routine failed: ${child.errorMessage ?? child.summary}`,
          metrics: { routineSessionId: child.sessionId, staged: 0, rejected: 0 },
        };
      }

      const routineRunId = stringFromMetrics(child.output, "routineRunId");
      let staged = 0;
      let rejected = 0;
      const stagedProposalPaths: string[] = [];
      if (routineRunId !== null) {
        const store = await RoutineStore.open({ repoRoot: context.repoRoot });
        let artifacts;
        try {
          artifacts = store
            .listRoutineArtifacts({ routineRunId })
            .filter((artifact) => artifact.validationStatus === "valid");
        } finally {
          store.close();
        }
        for (const artifact of artifacts) {
          const mapping = suggestionsToProposalInputs(artifact.payload, { minConfidence });
          rejected += mapping.rejected.length;
          for (const proposalInput of mapping.inputs) {
            const proposal = await stageIngestTaxonomyProposal(context.repoRoot, proposalInput);
            staged += 1;
            stagedProposalPaths.push(proposal.id);
          }
        }
      }

      return {
        status: "ok",
        summary: `Staged ${staged} taxonomy proposal${staged === 1 ? "" : "s"}${rejected > 0 ? ` (${rejected} suggestion${rejected === 1 ? "" : "s"} rejected)` : ""}.`,
        metrics: {
          routineSessionId: child.sessionId,
          routineRunId,
          staged,
          rejected,
          stagedProposalIds: stagedProposalPaths,
        },
        details: asJsonValue({ routine: child.output, stagedProposalIds: stagedProposalPaths }),
      };
    },
  };
}

function maintenanceRunJob(): JobDefinition<MaintenanceJobInput> {
  return {
    name: "maintenance.run",
    description: "Run one registered maintenance job and persist its normal maintenance trace.",
    mode: "write",
    defaultConcurrency: "skip",
    inputSchema: {
      type: "object",
      required: ["jobName"],
      properties: {
        jobName: {
          type: "string",
          description: "Maintenance job name, such as wiki.lint or index.refresh.",
        },
      },
    },
    async run(input, context) {
      const jobName = stringField(input.jobName, "jobName");
      const result = await runMaintenanceJob({ jobName, repoRoot: context.repoRoot });
      return {
        status: result.status,
        summary: result.summary,
        metrics: {
          findings: result.findings.length,
          proposals: result.proposals.length,
          maintenanceSessionId: result.sessionId,
        },
        details: result,
      };
    },
  };
}

function connectorPullJob(): JobDefinition<ConnectorPullJobInput> {
  return {
    name: "connector.pull",
    description:
      "Run a registered connector pull or dry-run, optionally index written raw snapshots, and refresh retrieval.",
    mode: "write",
    defaultConcurrency: "skip",
    inputSchema: {
      type: "object",
      required: ["connector"],
      properties: {
        connector: { type: "string", enum: ["granola", "notion", "slack"] },
        operation: { type: "string", enum: ["pull", "dry_run"], default: "pull" },
        config: { type: "object", default: {} },
        configProfileId: {
          type: "string",
          description:
            "Optional non-secret connector config profile id to resolve at run time before applying inline config overrides.",
        },
        lookbackMinutes: {
          type: "number",
          description: "When config.since is absent, set it to now minus this many minutes.",
        },
        index: { type: "boolean", default: false },
        refreshSearchIndex: { type: "boolean", default: false },
        title: { type: "string" },
      },
    },
    async run(input, context) {
      const connector = connectorName(input.connector);
      const operation = connectorOperation(input.operation);
      const config = connectorConfig(input.config);
      const configProfileId = optionalString(input.configProfileId, "configProfileId");
      const lookbackMinutes = connectorLookbackMinutes(input.lookbackMinutes);

      const result = await runConnectorWorkflow({
        connector,
        operation,
        config,
        ...(configProfileId === undefined ? {} : { configProfileId }),
        repoRoot: context.repoRoot,
        env: context.env,
        now: context.now,
        index: input.index === true,
        refreshSearchIndex: input.refreshSearchIndex === true,
        title: typeof input.title === "string" ? input.title : `Scheduled ${connector} pull`,
        ...(lookbackMinutes === undefined ? {} : { lookbackMinutes }),
      });
      return {
        status: "ok",
        summary: connectorPullSummary(
          connector,
          result.metrics.itemCount,
          result.metrics.writtenCount,
        ),
        metrics: asJsonObject(result.metrics),
        details: asJsonValue({
          configProfile: result.configProfile,
          connector: result.connectorResult,
          rawToWiki: result.rawToWiki,
          searchIndex: result.searchIndex,
        }),
      };
    },
  };
}

function rawIndexJob(): JobDefinition<RawIndexJobInput> {
  return {
    name: "raw.index",
    description: "Index supported raw source snapshots into curated wiki/source pages.",
    mode: "write",
    defaultConcurrency: "skip",
    inputSchema: {
      type: "object",
      properties: {
        source: { type: "string", enum: ["all", "granola", "notion", "slack"], default: "all" },
        rawPaths: { type: "array", items: { type: "string" } },
        limit: { type: "number" },
        dryRun: { type: "boolean", default: false },
      },
    },
    async run(input, context) {
      const source = rawIndexSource(input.source);
      const rawPaths = stringArray(input.rawPaths);
      const options = {
        repoRoot: context.repoRoot,
        source,
        dryRun: input.dryRun === true,
        ...(typeof input.limit === "number" ? { limit: input.limit } : {}),
        now: context.now,
      };
      const result = await runRawToWikiIndex(
        rawPaths === undefined ? options : { ...options, rawPaths },
      );
      return {
        status: result.skipped.length > 0 ? "needs_attention" : "ok",
        summary: `${result.dryRun ? "Previewed" : "Indexed"} ${result.indexed.length} raw source${result.indexed.length === 1 ? "" : "s"}.`,
        metrics: {
          rawToWikiSessionId: result.sessionId,
          scanned: result.scanned,
          indexed: result.indexed.length,
          skipped: result.skipped.length,
        },
        details: asJsonValue(result),
      };
    },
  };
}

function wikiSearchIndexRefreshJob(): JobDefinition<SearchIndexJobInput> {
  return {
    name: "wiki.search-index.refresh",
    description: "Refresh the local curated-first wiki/raw retrieval index.",
    mode: "write",
    defaultConcurrency: "skip",
    inputSchema: {
      type: "object",
      properties: {
        source: { type: "string", enum: ["all", "granola", "notion", "slack"], default: "all" },
        includeRaw: { type: "boolean", default: true },
      },
    },
    async run(input, context) {
      const source = rawIndexSource(input.source);
      const result = await refreshWikiSearchIndex({
        repoRoot: context.repoRoot,
        source,
        includeRaw: input.includeRaw !== false,
        now: context.now,
      });
      return {
        status: "ok",
        summary: `Indexed ${result.indexed} wiki document${result.indexed === 1 ? "" : "s"}.`,
        metrics: asJsonObject(result),
        details: asJsonValue(result),
      };
    },
  };
}

function wikiHygieneJob(): JobDefinition<WikiHygieneJobInput> {
  return {
    name: "wiki.hygiene",
    description:
      "Run the safe wiki entity-consolidation audit/proposal pass and optionally refresh retrieval.",
    mode: "write",
    defaultConcurrency: "skip",
    inputSchema: {
      type: "object",
      properties: {
        refreshSearchIndex: { type: "boolean", default: true },
        includeRaw: { type: "boolean", default: true },
      },
    },
    async run(input, context) {
      const entityAudit = await runMaintenanceJob({
        jobName: "wiki.entities",
        repoRoot: context.repoRoot,
      });
      const shouldRefresh = input.refreshSearchIndex !== false;
      const searchIndex = shouldRefresh
        ? await refreshWikiSearchIndex({
            repoRoot: context.repoRoot,
            source: "all",
            includeRaw: input.includeRaw !== false,
            now: context.now,
          })
        : null;

      const summaryParts = [
        entityAudit.summary,
        searchIndex === null
          ? "Search index refresh skipped."
          : `Indexed ${searchIndex.indexed} wiki document${searchIndex.indexed === 1 ? "" : "s"}.`,
      ];
      return {
        status: entityAudit.status,
        summary: summaryParts.join(" "),
        metrics: {
          maintenanceSessionId: entityAudit.sessionId,
          findings: entityAudit.findings.length,
          proposals: entityAudit.proposals.length,
          searchIndexed: searchIndex?.indexed ?? 0,
        },
        details: asJsonValue({
          entityAudit,
          searchIndex,
        }),
      };
    },
  };
}

function connectorName(value: JsonValue | undefined): ConnectorName {
  if (typeof value === "string" && CONNECTOR_NAMES.has(value)) {
    return value as ConnectorName;
  }
  throw new Error("connector must be one of: granola, notion, slack");
}

function connectorOperation(value: JsonValue | undefined): "pull" | "dry_run" {
  if (value === undefined || value === "pull") {
    return "pull";
  }
  if (value === "dry_run") {
    return "dry_run";
  }
  throw new Error("operation must be pull or dry_run");
}

function rawIndexSource(value: JsonValue | undefined): RawToWikiSourceFilter {
  const source = typeof value === "string" ? value : "all";
  if (RAW_INDEX_SOURCES.has(source)) {
    return source as RawToWikiSourceFilter;
  }
  throw new Error("source must be one of: all, granola, notion, slack");
}

function connectorConfig(value: JsonValue | undefined): ConnectorConfig {
  if (value === undefined) {
    return {};
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("config must be a JSON object");
  }
  return { ...(value as JsonObject) };
}

function jsonObjectField(value: JsonValue | undefined, label: string): JsonObject {
  if (value === undefined) {
    return {};
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return { ...(value as JsonObject) };
}

function connectorLookbackMinutes(value: JsonValue | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value < 1) {
    throw new Error("lookbackMinutes must be a positive number");
  }
  return value;
}

function stringField(value: JsonValue | undefined, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} is required`);
  }
  return value.trim();
}

function optionalString(value: JsonValue | undefined, label: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value.trim();
}

function optionalModelProvider(value: JsonValue | undefined): ModelProviderName | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === "string" && MODEL_PROVIDERS.has(value)) {
    return value as ModelProviderName;
  }
  throw new Error("provider must be one of: openai-codex, openai-compatible, anthropic-claude");
}

function optionalThinkingLevel(value: JsonValue | undefined): ThinkingLevel | undefined {
  if (value === undefined || value === "off") {
    return undefined;
  }
  if (typeof value === "string" && THINKING_LEVELS.includes(value as ThinkingLevel)) {
    return value as ThinkingLevel;
  }
  throw new Error("reasoningEffort must be one of: off, minimal, low, medium, high, xhigh");
}

function optionalPositiveNumber(value: JsonValue | undefined, label: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a non-negative number`);
  }
  return value;
}

function stringFromMetrics(output: JsonValue | null | undefined, key: string): string | null {
  if (
    output === null ||
    output === undefined ||
    typeof output !== "object" ||
    Array.isArray(output)
  ) {
    return null;
  }
  const metrics = output.metrics;
  if (typeof metrics !== "object" || metrics === null || Array.isArray(metrics)) {
    return null;
  }
  const value = metrics[key];
  return typeof value === "string" ? value : null;
}

function stringArray(value: JsonValue | undefined): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error("rawPaths must be an array of strings");
  }
  return value;
}

function connectorPullSummary(connector: ConnectorName, itemCount: number, writtenCount: number) {
  return `${connector} pull processed ${itemCount} item${itemCount === 1 ? "" : "s"} (${writtenCount} written).`;
}

function asJsonValue(value: unknown): JsonValue {
  return value as JsonValue;
}

function asJsonObject(value: unknown): JsonObject {
  return value as JsonObject;
}
