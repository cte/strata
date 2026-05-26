import { Check, ChevronDown, LoaderCircle } from "lucide-react";
import type * as React from "react";
import {
  ModelSelector,
  ModelSelectorContent,
  ModelSelectorEmpty,
  ModelSelectorGroup,
  ModelSelectorInput,
  ModelSelectorItem,
  ModelSelectorList,
  ModelSelectorName,
  ModelSelectorSeparator,
  ModelSelectorShortcut,
  ModelSelectorTrigger,
} from "@/components/ai-elements/model-selector";
import { Button } from "@/components/ui/button";
import {
  CHAT_REASONING_EFFORTS,
  type ChatModelChoice,
  type ChatProviderModelState,
  type ChatReasoningEffort,
} from "@/lib/useChatModelChoice";
import { cn } from "@/lib/utils";

export interface ChatModelPickerProps {
  choice: ChatModelChoice | null;
  providerStates: readonly ChatProviderModelState[];
  open: boolean;
  onOpenChange(open: boolean): void;
  onSelect(choice: ChatModelChoice): void;
  onReasoningEffortChange(effort: ChatReasoningEffort): void;
  disabled?: boolean;
}

const REASONING_LABELS: Record<ChatReasoningEffort, string> = {
  off: "off",
  minimal: "min",
  low: "low",
  medium: "med",
  high: "high",
  xhigh: "xhigh",
};

export function ChatModelPicker({
  choice,
  providerStates,
  open,
  onOpenChange,
  onSelect,
  onReasoningEffortChange,
  disabled = false,
}: ChatModelPickerProps): React.ReactElement {
  const currentEffort = choice?.reasoningEffort ?? "off";
  return (
    <ModelSelector open={open} onOpenChange={onOpenChange}>
      <ModelSelectorTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled}
          aria-label="Choose model"
          title="Choose model"
          className="h-7 max-w-full justify-start gap-1.5 px-2 font-mono text-[11.5px] text-[var(--fg-dim)] [&>svg]:!size-[13px]"
        >
          <span className="truncate">
            {choice === null ? "model" : `${providerShortLabel(choice.provider)}:${choice.model}`}
          </span>
          {choice === null || currentEffort === "off" ? null : (
            <span className="shrink-0 text-[var(--fg-mute)]">
              /{REASONING_LABELS[currentEffort]}
            </span>
          )}
          <ChevronDown
            size={13}
            strokeWidth={1.75}
            className={cn("shrink-0 transition-transform", open && "rotate-180")}
          />
        </Button>
      </ModelSelectorTrigger>
      <ModelSelectorContent
        title="Choose model"
        className="w-[min(680px,calc(100vw-2rem))] overflow-hidden rounded-lg border border-[var(--hairline-strong)] bg-[var(--surface)] text-[var(--fg)] shadow-2xl shadow-black/45"
      >
        <ModelSelectorInput placeholder="Search models..." />
        <ModelSelectorList className="max-h-[min(420px,60dvh)]">
          <ModelSelectorEmpty>No models found.</ModelSelectorEmpty>
          {providerStates.map((state) => (
            <ProviderModelGroup
              key={state.provider}
              state={state}
              choice={choice}
              onSelect={(model) => {
                onSelect({
                  provider: state.provider,
                  model,
                  reasoningEffort: currentEffort,
                });
                onOpenChange(false);
              }}
            />
          ))}
        </ModelSelectorList>
        <ModelSelectorSeparator />
        <ReasoningEffortSelector
          currentEffort={currentEffort}
          onReasoningEffortChange={onReasoningEffortChange}
        />
      </ModelSelectorContent>
    </ModelSelector>
  );
}

function ProviderModelGroup({
  state,
  choice,
  onSelect,
}: {
  state: ChatProviderModelState;
  choice: ChatModelChoice | null;
  onSelect(model: string): void;
}): React.ReactElement {
  return (
    <ModelSelectorGroup
      heading={
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate">{state.label}</span>
          {state.loading ? (
            <LoaderCircle size={13} strokeWidth={1.75} className="animate-spin" />
          ) : null}
          <span
            className={cn(
              "ml-auto min-w-0 truncate text-[10.5px] normal-case tracking-normal",
              state.available ? "text-[var(--fg-mute)]" : "text-[var(--warn)]",
            )}
          >
            {state.error ?? state.message}
          </span>
        </span>
      }
    >
      {!state.available ? null : state.models.length === 0 && !state.loading ? (
        <ModelSelectorItem disabled>No models returned.</ModelSelectorItem>
      ) : (
        state.models.map((model) => {
          const selected = choice?.provider === state.provider && choice.model === model.id;
          return (
            <ModelSelectorItem
              key={`${state.provider}:${model.id}`}
              value={`${state.label} ${state.provider} ${model.id} ${model.description}`}
              onSelect={() => onSelect(model.id)}
              className="gap-2 py-2 font-mono text-[11.5px]"
            >
              <ModelSelectorName>{model.id}</ModelSelectorName>
              {model.description === "" ? null : (
                <ModelSelectorShortcut className="hidden max-w-48 truncate normal-case tracking-normal sm:inline">
                  {model.description}
                </ModelSelectorShortcut>
              )}
              {selected ? (
                <Check
                  size={13}
                  strokeWidth={1.75}
                  className="ml-1 shrink-0 text-[var(--accent)]"
                />
              ) : null}
            </ModelSelectorItem>
          );
        })
      )}
    </ModelSelectorGroup>
  );
}

function ReasoningEffortSelector({
  currentEffort,
  onReasoningEffortChange,
}: {
  currentEffort: ChatReasoningEffort;
  onReasoningEffortChange(effort: ChatReasoningEffort): void;
}): React.ReactElement {
  return (
    <div className="p-2">
      <div className="mb-1.5 text-[10.5px] font-medium tracking-[0.14em] text-[var(--fg-mute)] uppercase">
        reasoning
      </div>
      <div className="grid grid-cols-6 gap-1">
        {CHAT_REASONING_EFFORTS.map((effort) => {
          const selected = currentEffort === effort;
          return (
            <button
              key={effort}
              type="button"
              className={cn(
                "h-7 rounded border px-1 text-center font-mono text-[10.5px] transition-colors duration-100",
                selected
                  ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--fg)]"
                  : "border-[var(--hairline)] text-[var(--fg-dim)] hover:border-[var(--fg-mute)] hover:text-[var(--fg)]",
              )}
              onClick={() => onReasoningEffortChange(effort)}
            >
              {REASONING_LABELS[effort]}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function providerShortLabel(provider: ChatModelChoice["provider"]): string {
  if (provider === "openai-codex") return "codex";
  if (provider === "anthropic-claude") return "claude";
  return "api";
}
