import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  type ChatModelStatus,
  type ChatModelSummary,
  getChatModelStatus,
  listChatModels,
  type StartChatRunRequest,
} from "@/lib/api";

export type ChatProviderName = NonNullable<StartChatRunRequest["provider"]>;
export type ChatReasoningEffort = NonNullable<StartChatRunRequest["reasoningEffort"]>;

export interface ChatModelChoice {
  provider: ChatProviderName;
  model: string;
  reasoningEffort: ChatReasoningEffort;
}

export interface ChatProviderModelState {
  provider: ChatProviderName;
  label: string;
  available: boolean;
  message: string;
  models: ChatModelSummary[];
  loading: boolean;
  error: string | null;
}

export interface UseChatModelChoiceResult {
  choice: ChatModelChoice | null;
  modelStatus: ChatModelStatus | null;
  providerStates: ChatProviderModelState[];
  setChoice(choice: ChatModelChoice): void;
  setReasoningEffort(effort: ChatReasoningEffort): void;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const CHAT_MODEL_CHOICE_STORAGE_KEY = "strata:chat:model";
export const CHAT_REASONING_EFFORTS: readonly ChatReasoningEffort[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
];

export function useChatModelChoice(
  storage: StorageLike | undefined = browserStorage(),
): UseChatModelChoiceResult {
  const [choice, setChoiceState] = useState<ChatModelChoice | null>(() =>
    readStoredChatModelChoice(storage),
  );
  const statusQuery = useQuery<ChatModelStatus>({
    queryKey: ["chat", "models", "status"],
    queryFn: getChatModelStatus,
    staleTime: 5 * 60_000,
  });
  const status = statusQuery.data ?? null;
  const codexModelsQuery = useQuery({
    queryKey: ["chat", "models", "list", "openai-codex"],
    queryFn: () => listChatModels("openai-codex"),
    enabled: status?.codexLoggedIn === true,
    staleTime: 5 * 60_000,
  });
  const anthropicAvailable =
    status?.anthropicLoggedIn === true || status?.anthropicApiKeyConfigured === true;
  const anthropicModelsQuery = useQuery({
    queryKey: ["chat", "models", "list", "anthropic-claude"],
    queryFn: () => listChatModels("anthropic-claude"),
    enabled: anthropicAvailable,
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    if (status === null) {
      return;
    }
    setChoiceState((current) => {
      const next = normalizeChoice(current, status);
      writeStoredChatModelChoice(storage, next);
      return next;
    });
  }, [status, storage]);

  const setChoice = useCallback(
    (nextChoice: ChatModelChoice) => {
      setChoiceState(nextChoice);
      writeStoredChatModelChoice(storage, nextChoice);
    },
    [storage],
  );

  const setReasoningEffort = useCallback(
    (effort: ChatReasoningEffort) => {
      setChoiceState((current) => {
        const next =
          current === null
            ? choiceFromStatus(status, effort)
            : { ...current, reasoningEffort: effort };
        if (next !== null) {
          writeStoredChatModelChoice(storage, next);
        }
        return next;
      });
    },
    [status, storage],
  );

  const providerStates = useMemo<ChatProviderModelState[]>(
    () => [
      {
        provider: "openai-codex",
        label: "OpenAI Codex",
        available: status?.codexLoggedIn === true,
        message: status?.codexLoggedIn === true ? "" : "Not connected",
        models: codexModelsQuery.data ?? [],
        loading: codexModelsQuery.isFetching,
        error: errorMessage(codexModelsQuery.error),
      },
      {
        provider: "anthropic-claude",
        label: "Anthropic Claude",
        available: anthropicAvailable,
        message: anthropicAvailable ? "" : "Not connected",
        models: anthropicModelsQuery.data ?? [],
        loading: anthropicModelsQuery.isFetching,
        error: errorMessage(anthropicModelsQuery.error),
      },
    ],
    [
      codexModelsQuery.data,
      codexModelsQuery.error,
      codexModelsQuery.isFetching,
      anthropicModelsQuery.data,
      anthropicModelsQuery.error,
      anthropicModelsQuery.isFetching,
      anthropicAvailable,
      status,
    ],
  );

  return { choice, modelStatus: status, providerStates, setChoice, setReasoningEffort };
}

export function readStoredChatModelChoice(
  storage: StorageLike | undefined,
): ChatModelChoice | null {
  if (storage === undefined) {
    return null;
  }
  return parseStoredChatModelChoice(storage.getItem(CHAT_MODEL_CHOICE_STORAGE_KEY));
}

export function writeStoredChatModelChoice(
  storage: StorageLike | undefined,
  choice: ChatModelChoice,
): void {
  storage?.setItem(CHAT_MODEL_CHOICE_STORAGE_KEY, JSON.stringify(choice));
}

export function parseStoredChatModelChoice(raw: string | null): ChatModelChoice | null {
  if (raw === null || raw.trim() === "") {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<ChatModelChoice>;
    if (!isProviderName(parsed.provider) || typeof parsed.model !== "string") {
      return null;
    }
    if (!isReasoningEffort(parsed.reasoningEffort)) {
      return null;
    }
    return {
      provider: parsed.provider,
      model: parsed.model,
      reasoningEffort: parsed.reasoningEffort,
    };
  } catch {
    return null;
  }
}

export function normalizeChoice(
  stored: ChatModelChoice | null,
  status: ChatModelStatus,
): ChatModelChoice {
  if (stored !== null && providerAvailable(stored.provider, status)) {
    return stored;
  }
  return (
    choiceFromStatus(status, stored?.reasoningEffort ?? "off") ?? {
      provider: status.provider,
      model: status.model,
      reasoningEffort: stored?.reasoningEffort ?? "off",
    }
  );
}

export function choiceFromSessionModel(
  sessionModel: string | null,
  providerStates: readonly Pick<ChatProviderModelState, "provider" | "models">[],
  reasoningEffort: ChatReasoningEffort,
  fallbackChoice: ChatModelChoice | null = null,
): ChatModelChoice | null {
  const parsed = parseSessionModelName(sessionModel);
  if (parsed === null) {
    return null;
  }
  if (parsed.provider !== null) {
    return {
      provider: parsed.provider,
      model: parsed.model,
      reasoningEffort,
    };
  }
  const matchedProvider = providerStates.find((state) =>
    state.models.some((model) => model.id === parsed.model),
  )?.provider;
  const provider =
    matchedProvider ??
    (fallbackChoice?.model === parsed.model ? fallbackChoice.provider : null) ??
    inferProviderFromModelName(parsed.model);
  if (provider === null) {
    return null;
  }
  return {
    provider,
    model: parsed.model,
    reasoningEffort,
  };
}

function choiceFromStatus(
  status: ChatModelStatus | null,
  reasoningEffort: ChatReasoningEffort,
): ChatModelChoice | null {
  if (status === null) {
    return null;
  }
  return {
    provider: status.provider,
    model: status.model,
    reasoningEffort,
  };
}

function providerAvailable(provider: ChatProviderName, status: ChatModelStatus): boolean {
  if (provider === "openai-codex") {
    return status.codexLoggedIn;
  }
  if (provider === "anthropic-claude") {
    return status.anthropicLoggedIn || status.anthropicApiKeyConfigured;
  }
  return status.apiKeyConfigured;
}

function parseSessionModelName(
  raw: string | null,
): { provider: ChatProviderName | null; model: string } | null {
  const value = raw?.trim();
  if (value === undefined || value === "") {
    return null;
  }
  const separator = value.indexOf(":");
  if (separator === -1) {
    return { provider: null, model: value };
  }
  const prefix = value.slice(0, separator);
  const model = value.slice(separator + 1);
  if (!isProviderName(prefix) || model === "") {
    return { provider: null, model: value };
  }
  return { provider: prefix, model };
}

function inferProviderFromModelName(model: string): ChatProviderName | null {
  if (model.startsWith("claude-")) {
    return "anthropic-claude";
  }
  if (
    model.startsWith("gpt-") ||
    model.startsWith("o1") ||
    model.startsWith("o3") ||
    model.startsWith("o4")
  ) {
    return "openai-codex";
  }
  return null;
}

function isProviderName(value: unknown): value is ChatProviderName {
  return value === "openai-codex" || value === "openai-compatible" || value === "anthropic-claude";
}

function isReasoningEffort(value: unknown): value is ChatReasoningEffort {
  return typeof value === "string" && (CHAT_REASONING_EFFORTS as readonly string[]).includes(value);
}

function errorMessage(error: unknown): string | null {
  if (error === null || error === undefined) {
    return null;
  }
  return error instanceof Error ? error.message : String(error);
}

function browserStorage(): StorageLike | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }
  return window.localStorage;
}
