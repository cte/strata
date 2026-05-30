import type { ModelCapabilities, ModelProviderName } from "@strata/agent";
import type { WikiSearchIndexSource, WikiSearchIndexStatus } from "@strata/core";
import type { ClassificationCorrection } from "@strata/core/classification-correction-store";
import type {
  LearningProposalApplyResult,
  LearningProposalDetail,
  LearningProposalKind,
  LearningProposalRecord,
  LearningProposalStatusFilter,
} from "@strata/core/proposal-store";
import type { JsonObject, TokenUsage } from "@strata/core/types";
import type {
  WikiActionItem,
  WikiActionOwner,
  WikiActionOwnerFilter,
  WikiActionStatusFilter,
} from "@strata/core/wiki-actions";
import type {
  IngestActivityResultFilter,
  IngestActivityRunDetail,
  IngestActivityRunSummary,
  IngestActivitySource,
} from "@strata/ingest/activity";
import type {
  ConnectorConfig,
  ConnectorName,
  ConnectorPullResult,
  ConnectorStatus,
} from "@strata/ingest/connector-types";
import type {
  ConnectorConfigProfileRecord,
  ConnectorWorkflowResult,
} from "@strata/ingest/connectors";
import type { ReviewQueueItem } from "@strata/ingest/review-queue";
import type {
  JobExecutionResult,
  JobMetadata,
  RoutineTriggerCadence,
  RoutineTriggerRecord,
  RoutineTriggerRunResult,
} from "@strata/jobs";
import type {
  RoutineArtifactRecord,
  RoutineDefinition,
  RoutineRunRecord,
  RoutineStatus,
} from "@strata/routines";
import { initTRPC } from "@trpc/server";
import { z } from "zod";

export interface ConnectorSummary {
  name: ConnectorName;
  displayName: string;
  description: string;
  state: ConnectorStatus["state"];
  configured: boolean;
  message: string;
  capabilities: string[];
}

export interface ConnectorSessionResult extends ConnectorPullResult {
  sessionId: string;
}

export type ConnectorRunResult = ConnectorWorkflowResult;

export interface ConnectorConfigProfilesResult {
  connector: ConnectorName;
  profiles: ConnectorConfigProfileRecord[];
  defaultProfile: ConnectorConfigProfileRecord | null;
}

export interface NotionMcpStatus {
  authenticated: boolean;
  state: "connected" | "not_connected" | "auth_pending" | "requires_reconnect";
  message: string;
  serverUrl: string;
  expiresAt?: string;
}

export interface NotionMcpStartResult {
  authenticated: boolean;
  authorizationUrl?: string;
  callbackUrl: string;
  message: string;
}

export interface NotionMcpToolSummary {
  name: string;
  description: string;
}

export interface GranolaStatus {
  state: "connected" | "not_configured" | "invalid";
  configured: boolean;
  message: string;
  validatedAt?: string;
}

export type ModelAuthProviderName = "openai-codex" | "anthropic-claude";

export interface ModelAuthProviderStatus {
  provider: ModelAuthProviderName;
  displayName: string;
  authenticated: boolean;
  state: "connected" | "not_connected" | "auth_pending";
  message: string;
  expiresAt?: number;
}

export type ModelApiKeyTarget = "openai" | "anthropic";

export interface ModelApiKeyStatus {
  target: ModelApiKeyTarget;
  displayName: string;
  configured: boolean;
  /** Masked last-4 hint (e.g. "…ab12"); present only when configured. Never the full key. */
  hint?: string;
  baseUrl?: string;
  supportsBaseUrl: boolean;
}

export interface ModelAuthStatus {
  providers: ModelAuthProviderStatus[];
  apiKeys: ModelApiKeyStatus[];
}

export interface ModelAuthStartResult {
  provider: ModelAuthProviderName;
  authenticated: false;
  authorizationUrl: string;
  callbackUrl: string;
  message: string;
}

export interface McpServerStatus {
  slug: string;
  displayName: string;
  serverUrl: string;
  enabled: boolean;
  selectedTools: string[];
  headerNames: string[];
  apiKeyConfigured: boolean;
  state: "enabled" | "disabled";
  message: string;
  updatedAt?: string;
}

export interface McpSettingsStatus {
  servers: McpServerStatus[];
}

export interface McpToolSummary {
  name: string;
  description: string;
}

export type ChatProviderName = "openai-codex" | "openai-compatible" | "anthropic-claude";

export type ChatSessionKind = "chat" | "query";
export type ChatSessionStatus = "running" | "completed" | "failed" | "interrupted";
export type ChatMessageRole = "system" | "user" | "assistant" | "tool";
export type BrowserJsonValue =
  | null
  | boolean
  | number
  | string
  | BrowserJsonValue[]
  | { [key: string]: BrowserJsonValue };

export interface ChatModelStatus {
  provider: ChatProviderName;
  model: string;
  codexLoggedIn: boolean;
  apiKeyConfigured: boolean;
  anthropicLoggedIn: boolean;
  anthropicApiKeyConfigured: boolean;
  codexExpiresAt?: number;
  anthropicExpiresAt?: number;
}

export interface ChatModelSummary {
  id: string;
  description: string;
  provider?: ModelProviderName;
  capabilities?: ModelCapabilities;
}

export interface RetrievalIndexRefreshResult {
  run: JobExecutionResult;
  status: WikiSearchIndexStatus;
}

export interface ChatFileEntry {
  path: string;
  isDirectory: boolean;
}

export interface ChatSkillEntry {
  name: string;
  description: string;
  path: string;
  source: "strata" | "agents";
  disableModelInvocation: boolean;
}

export interface ChatSkillInvocation {
  name: string;
  prompt: string;
}

export interface WikiTreeEntry {
  path: string;
  name: string;
  type: "directory" | "file";
  children?: WikiTreeEntry[];
}

export interface WikiPageDetail {
  path: string;
  content: string;
  chars: number;
}

export interface WikiActionListResult {
  actions: WikiActionItem[];
}

export interface WikiActionResult {
  action: WikiActionItem;
}

export interface IngestActivityListResult {
  runs: IngestActivityRunSummary[];
}

export type IngestActivityDetail = IngestActivityRunDetail;

export interface ProposalListResult {
  proposals: LearningProposalRecord[];
}

export interface ProposalStatusResult {
  proposal: LearningProposalRecord;
}

export interface RoutineListResult {
  routines: RoutineDefinition[];
}

export interface RoutineDetailResult {
  routine: RoutineDefinition | null;
}

export interface RoutineMutationResult {
  routine: RoutineDefinition;
}

export interface RoutineTemplateSummary {
  key: string;
  label: string;
  description: string;
}

export interface RoutineTemplatesListResult {
  templates: RoutineTemplateSummary[];
}

export interface RoutineRunsListResult {
  runs: RoutineRunRecord[];
}

export interface RoutineArtifactsListResult {
  artifacts: RoutineArtifactRecord[];
}

export interface ChatSessionSummary {
  id: string;
  title: string;
  kind: ChatSessionKind;
  startedAt: string;
  endedAt: string | null;
  status: ChatSessionStatus;
  model: string | null;
}

export interface ChatMessageSummary {
  id: number;
  role: ChatMessageRole;
  content: string;
  ts: string;
  toolCallId: string | null;
  toolCalls: BrowserJsonValue | null;
  attachments: BrowserJsonValue | null;
  usage: TokenUsage | null;
}

export interface ChatSessionDetail {
  session: ChatSessionSummary;
  messages: ChatMessageSummary[];
}

export interface ChatSessionDeleteResult {
  id: string;
  title: string;
  traceMethod: "trash" | "unlink" | "missing";
}

export interface ChatQueuedMessageSummary {
  id: string;
  sessionId?: string;
  runId?: string;
  message: string;
  attachments: BrowserJsonValue;
  provider?: string;
  model?: string;
  reasoningEffort?: string;
  createdAt: string;
}

export interface ChatActiveRunSummary {
  runId: string;
  startedAt: string;
  updatedAt?: string;
  endedAt?: string | null;
  status: ChatSessionStatus;
  cancelled: boolean;
  lastEventId?: number;
  sessionId?: string;
  continueSessionId?: string;
  stoppedReason?: string;
  errorMessage?: string;
}

export const notionConfigInput = z.object({
  pageId: z.string(),
  token: z.string().optional(),
  version: z.string().optional(),
});

export type NotionConnectorInput = z.output<typeof notionConfigInput>;

export const notionMcpStartInput = z.object({
  origin: z.string().url().optional(),
});

export type NotionMcpStartInput = z.output<typeof notionMcpStartInput>;

export const granolaConfigureInput = z.object({
  apiToken: z.string().min(1, "API key is required."),
});

export type GranolaConfigureRpcInput = z.output<typeof granolaConfigureInput>;

export const connectorRunInput = z.object({
  connector: z.enum(["granola", "notion", "slack"]),
  operation: z.enum(["dry_run", "pull"]).default("pull"),
  config: z.record(z.string(), z.any()).default({}),
  configProfileId: z.string().trim().min(1).optional(),
  lookbackMinutes: z.number().int().min(1).optional(),
  index: z.boolean().default(false),
  refreshSearchIndex: z.boolean().default(false),
  title: z.string().trim().min(1).optional(),
});

export type ConnectorRunRpcInput = z.output<typeof connectorRunInput> & {
  connector: ConnectorName;
  config: ConnectorConfig;
};

export const connectorConfigProfilesInput = z.object({
  connector: z.enum(["granola", "notion", "slack"]),
});

export type ConnectorConfigProfilesRpcInput = z.output<typeof connectorConfigProfilesInput> & {
  connector: ConnectorName;
};

export const connectorConfigProfileSaveInput = connectorConfigProfilesInput.extend({
  id: z.string().trim().min(1).optional(),
  label: z.string().trim().min(1).optional(),
  config: z.record(z.string(), z.any()).default({}),
  makeDefault: z.boolean().default(true),
});

export type ConnectorConfigProfileSaveRpcInput = z.output<
  typeof connectorConfigProfileSaveInput
> & {
  connector: ConnectorName;
  config: ConnectorConfig;
};

export const connectorConfigProfileIdInput = connectorConfigProfilesInput.extend({
  id: z.string().trim().min(1),
});

export type ConnectorConfigProfileIdRpcInput = z.output<typeof connectorConfigProfileIdInput> & {
  connector: ConnectorName;
};

export const chatSessionsListInput = z.object({
  limit: z.number().int().min(1).max(500).default(20),
});

export type ChatSessionsListInput = z.output<typeof chatSessionsListInput>;

export const chatSessionGetInput = z.object({
  sessionId: z.string().min(1),
});

export type ChatSessionGetInput = z.output<typeof chatSessionGetInput>;

export const chatSessionForkInput = z.object({
  sessionId: z.string().min(1),
});

export type ChatSessionForkInput = z.output<typeof chatSessionForkInput>;

export const chatSessionDeleteInput = z.object({
  sessionId: z.string().min(1),
});

export type ChatSessionDeleteInput = z.output<typeof chatSessionDeleteInput>;

export const chatSessionsSearchInput = z.object({
  query: z.string().min(1),
  limit: z.number().int().min(1).max(100).default(20),
});

export type ChatSessionsSearchInput = z.output<typeof chatSessionsSearchInput>;

export const chatRunGetInput = z.object({
  runId: z.string().min(1),
});

export type ChatRunGetInput = z.output<typeof chatRunGetInput>;

export const chatQueueTargetInput = z
  .object({
    sessionId: z.string().min(1).optional(),
    runId: z.string().min(1).optional(),
  })
  .refine((value) => value.sessionId !== undefined || value.runId !== undefined, {
    message: "sessionId or runId is required.",
  });

export type ChatQueueTargetInput = z.output<typeof chatQueueTargetInput>;

export const chatQueueAddInput = chatQueueTargetInput.extend({
  id: z.string().min(1),
  message: z.string().min(1),
  attachments: z.array(z.any()).default([]),
  provider: z.enum(["openai-codex", "openai-compatible", "anthropic-claude"]).optional(),
  model: z.string().min(1).optional(),
  reasoningEffort: z.enum(["off", "minimal", "low", "medium", "high", "xhigh"]).optional(),
});

export type ChatQueueAddInput = z.output<typeof chatQueueAddInput>;

export const chatQueueRemoveInput = z.object({
  id: z.string().min(1),
});

export type ChatQueueRemoveInput = z.output<typeof chatQueueRemoveInput>;

export const chatFilesListInput = z.object({
  query: z.string().default(""),
  limit: z.number().int().min(1).max(100).default(20),
});

export type ChatFilesListInput = z.output<typeof chatFilesListInput>;

export const chatModelsListInput = z.object({
  provider: z.enum(["openai-codex", "openai-compatible", "anthropic-claude"]),
});

export type ChatModelsListInput = z.output<typeof chatModelsListInput>;

export const chatSkillsListInput = z.object({
  query: z.string().default(""),
  limit: z.number().int().min(1).max(100).default(40),
});

export type ChatSkillsListInput = z.output<typeof chatSkillsListInput>;

export const chatSkillInvokeInput = z.object({
  name: z.string().min(1),
  args: z.string().default(""),
});

export type ChatSkillInvokeInput = z.output<typeof chatSkillInvokeInput>;

export const modelAuthProviderInput = z.object({
  provider: z.enum(["openai-codex", "anthropic-claude"]),
});

export type ModelAuthProviderInput = z.output<typeof modelAuthProviderInput>;

export const modelAuthStartInput = modelAuthProviderInput.extend({
  origin: z.string().url().optional(),
});

export type ModelAuthStartInput = z.output<typeof modelAuthStartInput>;

export const modelAuthCompleteInput = modelAuthProviderInput.extend({
  authorizationResponse: z.string().min(1),
});

export type ModelAuthCompleteInput = z.output<typeof modelAuthCompleteInput>;

export const modelApiKeyTargetInput = z.object({
  target: z.enum(["openai", "anthropic"]),
});

export type ModelApiKeyTargetInput = z.output<typeof modelApiKeyTargetInput>;

export const modelApiKeySetInput = modelApiKeyTargetInput.extend({
  apiKey: z.string().min(1),
  baseUrl: z.string().url().optional(),
});

export type ModelApiKeySetInput = z.output<typeof modelApiKeySetInput>;

export const mcpServerInput = z.object({
  slug: z.string().min(1),
});

export type McpServerInput = z.output<typeof mcpServerInput>;

export const mcpSettingsUpdateInput = mcpServerInput.extend({
  displayName: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
  serverUrl: z.string().url().optional(),
  selectedTools: z.array(z.string().min(1)).optional(),
  apiKey: z.string().optional(),
  clearApiKey: z.boolean().optional(),
});

export type McpSettingsUpdateInput = z.output<typeof mcpSettingsUpdateInput>;

export const mcpSettingsDeleteInput = mcpServerInput;

export type McpSettingsDeleteInput = z.output<typeof mcpSettingsDeleteInput>;

export const mcpToolsListInput = mcpServerInput.extend({
  serverUrl: z.string().url().optional(),
});

export type McpToolsListInput = z.output<typeof mcpToolsListInput>;

export const wikiTreeInput = z.object({
  includeRaw: z.boolean().default(false),
});

export type WikiTreeInput = z.output<typeof wikiTreeInput>;

export const wikiPageGetInput = z.object({
  path: z.string().min(1),
  includeRaw: z.boolean().default(false),
});

export type WikiPageGetInput = z.output<typeof wikiPageGetInput>;

export const wikiActionListInput = z.object({
  owner: z.enum(["all", "mine", "theirs"]).default("all"),
  status: z.enum(["all", "open", "done"]).default("open"),
  query: z.string().default(""),
});

export type WikiActionListRpcInput = z.output<typeof wikiActionListInput> & {
  owner: WikiActionOwnerFilter;
  status: WikiActionStatusFilter;
};

export const wikiActionUpdateInput = z.object({
  id: z.string().min(1),
  completed: z.boolean().optional(),
  context: z.string().max(4000).optional(),
});

export type WikiActionUpdateRpcInput = z.output<typeof wikiActionUpdateInput>;

export const wikiActionAddInput = z.object({
  owner: z.enum(["mine", "theirs"]),
  title: z.string().trim().min(1).max(1000),
  context: z.string().max(4000).optional(),
});

export type WikiActionAddRpcInput = z.output<typeof wikiActionAddInput> & {
  owner: WikiActionOwner;
};

export const wikiActionDeleteInput = z.object({
  id: z.string().min(1),
});

export type WikiActionDeleteRpcInput = z.output<typeof wikiActionDeleteInput>;

export const activityListInput = z.object({
  limit: z.number().int().min(1).max(200).default(50),
  source: z.enum(["all", "granola", "notion", "slack", "unknown"]).default("all"),
  resultFilters: z
    .array(
      z.enum([
        "raw_written",
        "wiki_indexed",
        "search_indexed",
        "skipped_or_previewed",
        "failed",
        "other",
      ]),
    )
    .optional(),
  writesOrIndexesOnly: z.boolean().default(false),
});

export type ActivityListRpcInput = z.output<typeof activityListInput> & {
  source: IngestActivitySource | "all";
  resultFilters?: IngestActivityResultFilter[];
};

export const activityGetInput = z.object({
  sessionId: z.string().min(1),
  itemLimit: z.number().int().min(1).max(200).default(200),
  resultFilters: z
    .array(
      z.enum([
        "raw_written",
        "wiki_indexed",
        "search_indexed",
        "skipped_or_previewed",
        "failed",
        "other",
      ]),
    )
    .optional(),
  writesOrIndexesOnly: z.boolean().default(false),
});

export type ActivityGetRpcInput = z.output<typeof activityGetInput> & {
  resultFilters?: IngestActivityResultFilter[];
};

export const taxonomyReviewListInput = z.object({
  source: z.enum(["all", "granola", "slack", "notion"]).default("all"),
  limit: z.number().int().min(1).max(200).default(50),
});

export type TaxonomyReviewListRpcInput = z.output<typeof taxonomyReviewListInput>;

export interface TaxonomyReviewListResult {
  items: ReviewQueueItem[];
}

export const taxonomyReviewCorrectInput = z.object({
  dedupeKey: z.string().min(1),
  source: z.string().min(1),
  targetSessionId: z.string().min(1),
  targetEventId: z.number().int(),
  rawPath: z.string().min(1),
  title: z.string().nullable().optional(),
  projectPaths: z.array(z.string()).default([]),
  reviewReason: z.string().optional(),
  verdict: z.enum(["confirm", "wrong_project", "unrecognized_project", "noise", "is_me", "not_me"]),
  projectLabel: z.string().trim().min(1).optional(),
  aliases: z.array(z.string().trim().min(1)).optional(),
  selfName: z.string().trim().min(1).optional(),
  ignorePattern: z.string().trim().min(1).optional(),
});

export type TaxonomyReviewCorrectRpcInput = z.output<typeof taxonomyReviewCorrectInput>;

export interface TaxonomyReviewCorrectResult {
  correction: ClassificationCorrection;
  /** True when the verdict mapped to a taxonomy operation that was applied directly. */
  applied: boolean;
  /** Human-readable description of what was applied (null for feedback-only verdicts). */
  appliedSummary: string | null;
  /** Whether the taxonomy file actually changed (false when the rule already existed). */
  changed: boolean;
}

export const proposalListInput = z.object({
  status: z
    .enum(["all", "pending", "deferred", "applied", "rejected", "superseded"])
    .default("pending"),
  kind: z.enum(["memory", "skill", "schema", "wiki"]).optional(),
  limit: z.number().int().min(1).max(500).default(100),
});

export type ProposalListRpcInput = z.output<typeof proposalListInput> & {
  status: LearningProposalStatusFilter;
  kind?: LearningProposalKind;
};

export const proposalGetInput = z.object({
  id: z.string().min(1),
});

export type ProposalGetRpcInput = z.output<typeof proposalGetInput>;

export const proposalActionInput = proposalGetInput.extend({
  reason: z.string().trim().min(1).optional(),
  previewFingerprint: z.string().trim().min(1).optional(),
});

export type ProposalActionRpcInput = z.output<typeof proposalActionInput>;

const jsonObjectInput = z.record(z.string(), z.any()).default({});

export const routineListInput = z.object({
  status: z.enum(["all", "enabled", "disabled", "archived"]).default("all"),
  limit: z.number().int().min(1).max(500).default(100),
});

export type RoutineListRpcInput = z.output<typeof routineListInput> & {
  status: RoutineStatus | "all";
};

export const routineGetInput = z.object({
  id: z.string().min(1),
});

export type RoutineGetRpcInput = z.output<typeof routineGetInput>;

export const routineRunInput = routineGetInput.extend({
  input: jsonObjectInput,
  provider: z.enum(["openai-codex", "openai-compatible", "anthropic-claude"]).optional(),
  model: z.string().min(1).optional(),
  reasoningEffort: z.enum(["off", "minimal", "low", "medium", "high", "xhigh"]).optional(),
});

export type RoutineRunRpcInput = z.output<typeof routineRunInput> & {
  input: JsonObject;
};

export const retrievalIndexRefreshInput = z.object({
  source: z.enum(["all", "granola", "notion", "slack"]).default("all"),
  includeRaw: z.boolean().default(true),
});

export type RetrievalIndexRefreshRpcInput = z.output<typeof retrievalIndexRefreshInput> & {
  source: WikiSearchIndexSource;
};

const routinePreRunStepInput = z.object({
  jobName: z.string().trim().min(1),
  input: z.record(z.string(), z.any()).default({}),
});

const routineStatusInput = z.enum(["enabled", "disabled", "archived"]);
const routineOutputModeInput = z.enum(["required", "optional", "none"]);
const routineToolProfileInput = z.enum(["read-only", "maintenance", "learning", "dangerous"]);
const nullableJsonObjectInput = z.record(z.string(), z.any()).nullable();

export const routineCreateInput = z.object({
  id: z.string().trim().min(1).optional(),
  name: z.string().trim().min(1),
  description: z.string().trim().min(1),
  status: routineStatusInput.optional(),
  prompt: z.string().trim().min(1),
  inputSchema: z.record(z.string(), z.any()).default({}),
  defaultInput: nullableJsonObjectInput.optional(),
  outputSchema: nullableJsonObjectInput.optional(),
  outputMode: routineOutputModeInput.optional(),
  toolProfile: routineToolProfileInput.optional(),
  requiredSkills: z.array(z.string().trim().min(1)).optional(),
  preRunSteps: z.array(routinePreRunStepInput).optional(),
  publicationPolicy: z.record(z.string(), z.any()).optional(),
});

export type RoutineCreateRpcInput = z.output<typeof routineCreateInput>;

export const routineUpdateInput = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1).optional(),
  description: z.string().trim().min(1).optional(),
  status: routineStatusInput.optional(),
  prompt: z.string().trim().min(1).optional(),
  inputSchema: z.record(z.string(), z.any()).optional(),
  defaultInput: nullableJsonObjectInput.optional(),
  outputSchema: nullableJsonObjectInput.optional(),
  outputMode: routineOutputModeInput.optional(),
  toolProfile: routineToolProfileInput.optional(),
  requiredSkills: z.array(z.string().trim().min(1)).optional(),
  preRunSteps: z.array(routinePreRunStepInput).optional(),
  publicationPolicy: z.record(z.string(), z.any()).optional(),
});

export type RoutineUpdateRpcInput = z.output<typeof routineUpdateInput>;

export const routineSetStatusInput = routineGetInput.extend({
  status: routineStatusInput,
});

export type RoutineSetStatusRpcInput = z.output<typeof routineSetStatusInput>;

export const routineDeleteInput = routineGetInput;

export type RoutineDeleteRpcInput = z.output<typeof routineDeleteInput>;

export const routineTemplateCreateInput = z.object({
  key: z.string().trim().min(1),
});

export type RoutineTemplateCreateRpcInput = z.output<typeof routineTemplateCreateInput>;

export const routineRunsListInput = z.object({
  routineId: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(500).default(100),
});

export type RoutineRunsListRpcInput = z.output<typeof routineRunsListInput>;

export const routineArtifactsListInput = z.object({
  routineId: z.string().min(1).optional(),
  routineRunId: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(500).default(100),
});

export type RoutineArtifactsListRpcInput = z.output<typeof routineArtifactsListInput>;

const routineTriggerCadenceInput = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("interval"),
    seconds: z.number().int().min(1),
  }),
  z.object({
    type: z.literal("cron"),
    expression: z.string().min(1),
  }),
]);

export const routineTriggerListInput = z.object({
  routineId: z.string().min(1),
});

export type RoutineTriggerListRpcInput = z.output<typeof routineTriggerListInput>;

export const routineTriggerCreateInput = z.object({
  routineId: z.string().min(1),
  name: z.string().min(1).optional(),
  input: jsonObjectInput.optional(),
  trigger: routineTriggerCadenceInput,
  enabled: z.boolean().default(true),
});

export type RoutineTriggerCreateRpcInput = z.output<typeof routineTriggerCreateInput> & {
  input?: JsonObject;
  trigger: RoutineTriggerCadence;
};

export const routineTriggerUpdateInput = z.object({
  id: z.string().min(1),
  name: z.string().min(1).optional(),
  input: jsonObjectInput.optional(),
  trigger: routineTriggerCadenceInput.optional(),
  enabled: z.boolean().optional(),
});

export type RoutineTriggerUpdateRpcInput = z.output<typeof routineTriggerUpdateInput> & {
  input?: JsonObject;
  trigger?: RoutineTriggerCadence;
};

export const routineTriggerIdInput = z.object({
  id: z.string().min(1),
});

export type RoutineTriggerDeleteRpcInput = z.output<typeof routineTriggerIdInput>;
export type RoutineTriggerRunNowRpcInput = z.output<typeof routineTriggerIdInput>;

export interface WebApiServices {
  health(): { ok: true; repoRoot: string };
  chatModelStatus(): Promise<ChatModelStatus>;
  listChatModels(input: ChatModelsListInput): Promise<{ models: ChatModelSummary[] }>;
  listChatFiles(input: ChatFilesListInput): { entries: ChatFileEntry[] };
  listChatSkills(input: ChatSkillsListInput): Promise<{ skills: ChatSkillEntry[] }>;
  invokeChatSkill(input: ChatSkillInvokeInput): Promise<ChatSkillInvocation>;
  listActiveChatRuns(): { runs: ChatActiveRunSummary[] };
  getChatRun(input: ChatRunGetInput): { run: ChatActiveRunSummary | null };
  listChatQueuedMessages(input: ChatQueueTargetInput): { messages: ChatQueuedMessageSummary[] };
  addChatQueuedMessage(input: ChatQueueAddInput): Promise<ChatQueuedMessageSummary>;
  removeChatQueuedMessage(input: ChatQueueRemoveInput): Promise<{ removed: boolean }>;
  clearChatQueuedMessages(input: ChatQueueTargetInput): Promise<{ removed: number }>;
  listChatSessions(input: ChatSessionsListInput): Promise<{ sessions: ChatSessionSummary[] }>;
  getChatSession(input: ChatSessionGetInput): Promise<ChatSessionDetail | null>;
  forkChatSession(input: ChatSessionForkInput): Promise<ChatSessionDetail>;
  deleteChatSession(input: ChatSessionDeleteInput): Promise<ChatSessionDeleteResult>;
  searchChatSessions(input: ChatSessionsSearchInput): Promise<{ sessions: ChatSessionSummary[] }>;
  getWikiTree(input: WikiTreeInput): Promise<{ tree: WikiTreeEntry[] }>;
  getWikiPage(input: WikiPageGetInput): Promise<WikiPageDetail>;
  listWikiActions(input: WikiActionListRpcInput): Promise<WikiActionListResult>;
  updateWikiAction(input: WikiActionUpdateRpcInput): Promise<WikiActionResult>;
  addWikiAction(input: WikiActionAddRpcInput): Promise<WikiActionResult>;
  deleteWikiAction(input: WikiActionDeleteRpcInput): Promise<{ deleted: boolean }>;
  listIngestActivity(input: ActivityListRpcInput): Promise<IngestActivityListResult>;
  getIngestActivity(input: ActivityGetRpcInput): Promise<IngestActivityDetail | null>;
  listTaxonomyReview(input: TaxonomyReviewListRpcInput): Promise<TaxonomyReviewListResult>;
  correctTaxonomyReview(input: TaxonomyReviewCorrectRpcInput): Promise<TaxonomyReviewCorrectResult>;
  listProposals(input: ProposalListRpcInput): Promise<ProposalListResult>;
  getProposal(input: ProposalGetRpcInput): Promise<LearningProposalDetail | null>;
  applyProposal(input: ProposalActionRpcInput): Promise<LearningProposalApplyResult>;
  rejectProposal(input: ProposalActionRpcInput): Promise<ProposalStatusResult>;
  deferProposal(input: ProposalActionRpcInput): Promise<ProposalStatusResult>;

  listRoutines(input: RoutineListRpcInput): Promise<RoutineListResult>;
  getRoutine(input: RoutineGetRpcInput): Promise<RoutineDetailResult>;
  createRoutine(input: RoutineCreateRpcInput): Promise<RoutineMutationResult>;
  updateRoutine(input: RoutineUpdateRpcInput): Promise<RoutineMutationResult>;
  setRoutineStatus(input: RoutineSetStatusRpcInput): Promise<RoutineMutationResult>;
  deleteRoutine(input: RoutineDeleteRpcInput): Promise<{ deleted: boolean }>;
  listRoutineTemplates(): RoutineTemplatesListResult;
  createRoutineFromTemplate(input: RoutineTemplateCreateRpcInput): Promise<RoutineMutationResult>;
  runRoutine(input: RoutineRunRpcInput): Promise<JobExecutionResult>;
  listRoutineRuns(input: RoutineRunsListRpcInput): Promise<RoutineRunsListResult>;
  listRoutineArtifacts(input: RoutineArtifactsListRpcInput): Promise<RoutineArtifactsListResult>;
  listRoutineTriggers(
    input: RoutineTriggerListRpcInput,
  ): Promise<{ triggers: RoutineTriggerRecord[] }>;
  createRoutineTrigger(
    input: RoutineTriggerCreateRpcInput,
  ): Promise<{ trigger: RoutineTriggerRecord }>;
  updateRoutineTrigger(
    input: RoutineTriggerUpdateRpcInput,
  ): Promise<{ trigger: RoutineTriggerRecord }>;
  deleteRoutineTrigger(input: RoutineTriggerDeleteRpcInput): Promise<{ deleted: boolean }>;
  runRoutineTriggerNow(input: RoutineTriggerRunNowRpcInput): Promise<RoutineTriggerRunResult>;

  listJobs(): { jobs: JobMetadata[] };
  retrievalIndexStatus(): Promise<WikiSearchIndexStatus>;
  refreshRetrievalIndex(input: RetrievalIndexRefreshRpcInput): Promise<RetrievalIndexRefreshResult>;

  modelAuthStatus(): Promise<ModelAuthStatus>;
  startModelAuth(input: ModelAuthStartInput): Promise<ModelAuthStartResult>;
  completeModelAuth(input: ModelAuthCompleteInput): Promise<ModelAuthStatus>;
  disconnectModelAuth(input: ModelAuthProviderInput): Promise<ModelAuthStatus>;
  setModelApiKey(input: ModelApiKeySetInput): Promise<ModelAuthStatus>;
  clearModelApiKey(input: ModelApiKeyTargetInput): Promise<ModelAuthStatus>;

  mcpSettingsStatus(): Promise<McpSettingsStatus>;
  updateMcpSettings(input: McpSettingsUpdateInput): Promise<McpSettingsStatus>;
  deleteMcpSettings(input: McpSettingsDeleteInput): Promise<McpSettingsStatus>;
  listMcpTools(input: McpToolsListInput): Promise<{ tools: McpToolSummary[] }>;

  connectorSummaries(): ConnectorSummary[];
  runConnectorSession(input: ConnectorRunRpcInput): Promise<ConnectorRunResult>;
  listConnectorConfigProfiles(
    input: ConnectorConfigProfilesRpcInput,
  ): Promise<ConnectorConfigProfilesResult>;
  saveConnectorConfigProfile(
    input: ConnectorConfigProfileSaveRpcInput,
  ): Promise<ConnectorConfigProfilesResult>;
  deleteConnectorConfigProfile(
    input: ConnectorConfigProfileIdRpcInput,
  ): Promise<ConnectorConfigProfilesResult>;
  setDefaultConnectorConfigProfile(
    input: ConnectorConfigProfileIdRpcInput,
  ): Promise<ConnectorConfigProfilesResult>;

  validateNotion(config: NotionConnectorInput): Promise<ConnectorStatus>;
  runNotionSession(
    operation: "dry_run" | "pull",
    config: NotionConnectorInput,
  ): Promise<ConnectorSessionResult>;
  notionMcpStatus(): Promise<NotionMcpStatus>;
  startNotionMcp(input: NotionMcpStartInput): Promise<NotionMcpStartResult>;
  listNotionMcpTools(): Promise<{ tools: NotionMcpToolSummary[] }>;
  disconnectNotionMcp(): Promise<NotionMcpStatus>;
  granolaStatus(): Promise<GranolaStatus>;
  configureGranola(input: GranolaConfigureRpcInput): Promise<GranolaStatus>;
  disconnectGranola(): Promise<GranolaStatus>;
}

export interface WebApiContext {
  services: WebApiServices;
}

const t = initTRPC.context<WebApiContext>().create();

export const appRouter = t.router({
  health: t.procedure.query(({ ctx }) => ctx.services.health()),
  chat: t.router({
    models: t.router({
      status: t.procedure.query(({ ctx }) => ctx.services.chatModelStatus()),
      list: t.procedure
        .input(chatModelsListInput)
        .query(({ ctx, input }) => ctx.services.listChatModels(input)),
    }),
    files: t.router({
      list: t.procedure
        .input(chatFilesListInput)
        .query(({ ctx, input }) => ctx.services.listChatFiles(input)),
    }),
    skills: t.router({
      list: t.procedure
        .input(chatSkillsListInput)
        .query(({ ctx, input }) => ctx.services.listChatSkills(input)),
      invoke: t.procedure
        .input(chatSkillInvokeInput)
        .query(({ ctx, input }) => ctx.services.invokeChatSkill(input)),
    }),
    runs: t.router({
      active: t.procedure.query(({ ctx }) => ctx.services.listActiveChatRuns()),
      get: t.procedure
        .input(chatRunGetInput)
        .query(({ ctx, input }) => ctx.services.getChatRun(input)),
    }),
    queue: t.router({
      list: t.procedure
        .input(chatQueueTargetInput)
        .query(({ ctx, input }) => ctx.services.listChatQueuedMessages(input)),
      add: t.procedure
        .input(chatQueueAddInput)
        .mutation(({ ctx, input }) => ctx.services.addChatQueuedMessage(input)),
      remove: t.procedure
        .input(chatQueueRemoveInput)
        .mutation(({ ctx, input }) => ctx.services.removeChatQueuedMessage(input)),
      clear: t.procedure
        .input(chatQueueTargetInput)
        .mutation(({ ctx, input }) => ctx.services.clearChatQueuedMessages(input)),
    }),
    sessions: t.router({
      list: t.procedure
        .input(chatSessionsListInput)
        .query(({ ctx, input }) => ctx.services.listChatSessions(input)),
      get: t.procedure
        .input(chatSessionGetInput)
        .query(({ ctx, input }) => ctx.services.getChatSession(input)),
      fork: t.procedure
        .input(chatSessionForkInput)
        .mutation(({ ctx, input }) => ctx.services.forkChatSession(input)),
      delete: t.procedure
        .input(chatSessionDeleteInput)
        .mutation(({ ctx, input }) => ctx.services.deleteChatSession(input)),
      search: t.procedure
        .input(chatSessionsSearchInput)
        .query(({ ctx, input }) => ctx.services.searchChatSessions(input)),
    }),
  }),
  wiki: t.router({
    tree: t.procedure
      .input(wikiTreeInput)
      .query(({ ctx, input }) => ctx.services.getWikiTree(input)),
    page: t.procedure
      .input(wikiPageGetInput)
      .query(({ ctx, input }) => ctx.services.getWikiPage(input)),
    actions: t.router({
      list: t.procedure
        .input(wikiActionListInput)
        .query(({ ctx, input }) => ctx.services.listWikiActions(input as WikiActionListRpcInput)),
      update: t.procedure
        .input(wikiActionUpdateInput)
        .mutation(({ ctx, input }) => ctx.services.updateWikiAction(input)),
      add: t.procedure
        .input(wikiActionAddInput)
        .mutation(({ ctx, input }) => ctx.services.addWikiAction(input as WikiActionAddRpcInput)),
      delete: t.procedure
        .input(wikiActionDeleteInput)
        .mutation(({ ctx, input }) => ctx.services.deleteWikiAction(input)),
    }),
  }),
  activity: t.router({
    list: t.procedure
      .input(activityListInput)
      .query(({ ctx, input }) => ctx.services.listIngestActivity(input as ActivityListRpcInput)),
    get: t.procedure
      .input(activityGetInput)
      .query(({ ctx, input }) => ctx.services.getIngestActivity(input as ActivityGetRpcInput)),
  }),
  ingest: t.router({
    taxonomy: t.router({
      review: t.router({
        list: t.procedure
          .input(taxonomyReviewListInput)
          .query(({ ctx, input }) => ctx.services.listTaxonomyReview(input)),
        correct: t.procedure
          .input(taxonomyReviewCorrectInput)
          .mutation(({ ctx, input }) =>
            ctx.services.correctTaxonomyReview(input as TaxonomyReviewCorrectRpcInput),
          ),
      }),
    }),
  }),
  proposals: t.router({
    list: t.procedure
      .input(proposalListInput)
      .query(({ ctx, input }) => ctx.services.listProposals(input as ProposalListRpcInput)),
    get: t.procedure
      .input(proposalGetInput)
      .query(({ ctx, input }) => ctx.services.getProposal(input)),
    accept: t.procedure
      .input(proposalActionInput)
      .mutation(({ ctx, input }) => ctx.services.applyProposal(input)),
    reject: t.procedure
      .input(proposalActionInput)
      .mutation(({ ctx, input }) => ctx.services.rejectProposal(input)),
    defer: t.procedure
      .input(proposalActionInput)
      .mutation(({ ctx, input }) => ctx.services.deferProposal(input)),
  }),
  routines: t.router({
    list: t.procedure
      .input(routineListInput)
      .query(({ ctx, input }) => ctx.services.listRoutines(input as RoutineListRpcInput)),
    get: t.procedure
      .input(routineGetInput)
      .query(({ ctx, input }) => ctx.services.getRoutine(input)),
    create: t.procedure
      .input(routineCreateInput)
      .mutation(({ ctx, input }) => ctx.services.createRoutine(input as RoutineCreateRpcInput)),
    update: t.procedure
      .input(routineUpdateInput)
      .mutation(({ ctx, input }) => ctx.services.updateRoutine(input as RoutineUpdateRpcInput)),
    setStatus: t.procedure
      .input(routineSetStatusInput)
      .mutation(({ ctx, input }) => ctx.services.setRoutineStatus(input)),
    delete: t.procedure
      .input(routineDeleteInput)
      .mutation(({ ctx, input }) => ctx.services.deleteRoutine(input)),
    templates: t.router({
      list: t.procedure.query(({ ctx }) => ctx.services.listRoutineTemplates()),
      create: t.procedure
        .input(routineTemplateCreateInput)
        .mutation(({ ctx, input }) => ctx.services.createRoutineFromTemplate(input)),
    }),
    run: t.procedure
      .input(routineRunInput)
      .mutation(({ ctx, input }) => ctx.services.runRoutine(input as RoutineRunRpcInput)),
    runs: t.router({
      list: t.procedure
        .input(routineRunsListInput)
        .query(({ ctx, input }) => ctx.services.listRoutineRuns(input)),
    }),
    artifacts: t.router({
      list: t.procedure
        .input(routineArtifactsListInput)
        .query(({ ctx, input }) => ctx.services.listRoutineArtifacts(input)),
    }),
    triggers: t.router({
      list: t.procedure
        .input(routineTriggerListInput)
        .query(({ ctx, input }) => ctx.services.listRoutineTriggers(input)),
      create: t.procedure
        .input(routineTriggerCreateInput)
        .mutation(({ ctx, input }) =>
          ctx.services.createRoutineTrigger(input as RoutineTriggerCreateRpcInput),
        ),
      update: t.procedure
        .input(routineTriggerUpdateInput)
        .mutation(({ ctx, input }) =>
          ctx.services.updateRoutineTrigger(input as RoutineTriggerUpdateRpcInput),
        ),
      delete: t.procedure
        .input(routineTriggerIdInput)
        .mutation(({ ctx, input }) => ctx.services.deleteRoutineTrigger(input)),
      runNow: t.procedure
        .input(routineTriggerIdInput)
        .mutation(({ ctx, input }) => ctx.services.runRoutineTriggerNow(input)),
    }),
  }),
  jobs: t.router({
    list: t.procedure.query(({ ctx }) => ctx.services.listJobs()),
  }),
  system: t.router({
    retrievalIndex: t.router({
      status: t.procedure.query(({ ctx }) => ctx.services.retrievalIndexStatus()),
      refresh: t.procedure
        .input(retrievalIndexRefreshInput)
        .mutation(({ ctx, input }) =>
          ctx.services.refreshRetrievalIndex(input as RetrievalIndexRefreshRpcInput),
        ),
    }),
  }),
  auth: t.router({
    models: t.router({
      status: t.procedure.query(({ ctx }) => ctx.services.modelAuthStatus()),
      start: t.procedure
        .input(modelAuthStartInput)
        .mutation(({ ctx, input }) => ctx.services.startModelAuth(input)),
      complete: t.procedure
        .input(modelAuthCompleteInput)
        .mutation(({ ctx, input }) => ctx.services.completeModelAuth(input)),
      disconnect: t.procedure
        .input(modelAuthProviderInput)
        .mutation(({ ctx, input }) => ctx.services.disconnectModelAuth(input)),
      setApiKey: t.procedure
        .input(modelApiKeySetInput)
        .mutation(({ ctx, input }) => ctx.services.setModelApiKey(input)),
      clearApiKey: t.procedure
        .input(modelApiKeyTargetInput)
        .mutation(({ ctx, input }) => ctx.services.clearModelApiKey(input)),
    }),
  }),
  mcps: t.router({
    status: t.procedure.query(({ ctx }) => ctx.services.mcpSettingsStatus()),
    update: t.procedure
      .input(mcpSettingsUpdateInput)
      .mutation(({ ctx, input }) => ctx.services.updateMcpSettings(input)),
    delete: t.procedure
      .input(mcpSettingsDeleteInput)
      .mutation(({ ctx, input }) => ctx.services.deleteMcpSettings(input)),
    tools: t.router({
      list: t.procedure
        .input(mcpToolsListInput)
        .query(({ ctx, input }) => ctx.services.listMcpTools(input)),
    }),
  }),
  connectors: t.router({
    list: t.procedure.query(({ ctx }) => ({
      connectors: ctx.services.connectorSummaries(),
    })),
    run: t.procedure
      .input(connectorRunInput)
      .mutation(({ ctx, input }) =>
        ctx.services.runConnectorSession(input as ConnectorRunRpcInput),
      ),
    config: t.router({
      list: t.procedure
        .input(connectorConfigProfilesInput)
        .query(({ ctx, input }) =>
          ctx.services.listConnectorConfigProfiles(input as ConnectorConfigProfilesRpcInput),
        ),
      save: t.procedure
        .input(connectorConfigProfileSaveInput)
        .mutation(({ ctx, input }) =>
          ctx.services.saveConnectorConfigProfile(input as ConnectorConfigProfileSaveRpcInput),
        ),
      delete: t.procedure
        .input(connectorConfigProfileIdInput)
        .mutation(({ ctx, input }) =>
          ctx.services.deleteConnectorConfigProfile(input as ConnectorConfigProfileIdRpcInput),
        ),
      setDefault: t.procedure
        .input(connectorConfigProfileIdInput)
        .mutation(({ ctx, input }) =>
          ctx.services.setDefaultConnectorConfigProfile(input as ConnectorConfigProfileIdRpcInput),
        ),
    }),
    notion: t.router({
      validate: t.procedure
        .input(notionConfigInput)
        .mutation(({ ctx, input }) => ctx.services.validateNotion(input)),
      dryRun: t.procedure
        .input(notionConfigInput)
        .mutation(({ ctx, input }) => ctx.services.runNotionSession("dry_run", input)),
      pull: t.procedure
        .input(notionConfigInput)
        .mutation(({ ctx, input }) => ctx.services.runNotionSession("pull", input)),
      mcp: t.router({
        status: t.procedure.query(({ ctx }) => ctx.services.notionMcpStatus()),
        start: t.procedure
          .input(notionMcpStartInput)
          .mutation(({ ctx, input }) => ctx.services.startNotionMcp(input)),
        listTools: t.procedure.query(({ ctx }) => ctx.services.listNotionMcpTools()),
        disconnect: t.procedure.mutation(({ ctx }) => ctx.services.disconnectNotionMcp()),
      }),
    }),
    granola: t.router({
      status: t.procedure.query(({ ctx }) => ctx.services.granolaStatus()),
      configure: t.procedure
        .input(granolaConfigureInput)
        .mutation(({ ctx, input }) => ctx.services.configureGranola(input)),
      disconnect: t.procedure.mutation(({ ctx }) => ctx.services.disconnectGranola()),
    }),
  }),
});

export type AppRouter = typeof appRouter;
