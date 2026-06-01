import { Brain, Check, ChevronDown, LoaderCircle, Plug } from "lucide-react";
import type * as React from "react";
import { useState } from "react";
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
import { ModelAuthDialog } from "@/components/model-auth-dialog";
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
  const [authOpen, setAuthOpen] = useState(false);
  const openProviderAuth = () => {
    onOpenChange(false);
    setAuthOpen(true);
  };
  return (
    <>
      <ModelSelector open={open} onOpenChange={onOpenChange}>
        <ModelSelectorTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled}
            aria-label="Choose model"
            title="Choose model"
            className="h-7 max-w-full justify-start gap-1.5 px-2 font-mono text-xs text-fg-dim [&>svg]:!size-[13px]"
          >
            <span className="truncate">
              {choice === null ? "model" : `${providerShortLabel(choice.provider)}:${choice.model}`}
            </span>
            {choice === null || currentEffort === "off" ? null : (
              <span className="shrink-0 text-fg-mute">/{REASONING_LABELS[currentEffort]}</span>
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
          className="w-[min(680px,calc(100vw-2rem))] overflow-hidden rounded-lg border border-hairline-strong bg-surface text-fg shadow-2xl shadow-black/45"
        >
          <ModelSelectorInput placeholder="Search models..." />
          <ModelSelectorList className="max-h-[min(420px,60dvh)]">
            <ModelSelectorEmpty>No models found.</ModelSelectorEmpty>
            {providerStates.map((state) => (
              <ProviderModelGroup
                key={state.provider}
                state={state}
                choice={choice}
                onManageProviders={openProviderAuth}
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
          <PickerFooter
            currentEffort={currentEffort}
            onReasoningEffortChange={onReasoningEffortChange}
            onManageProviders={openProviderAuth}
          />
        </ModelSelectorContent>
      </ModelSelector>
      <ModelAuthDialog open={authOpen} onOpenChange={setAuthOpen} />
    </>
  );
}

function ProviderModelGroup({
  state,
  choice,
  onSelect,
  onManageProviders,
}: {
  state: ChatProviderModelState;
  choice: ChatModelChoice | null;
  onSelect(model: string): void;
  onManageProviders(): void;
}): React.ReactElement {
  // openai-compatible auth is an env API key, not OAuth — no connect action.
  const canConnect = !state.available && state.provider !== "openai-compatible";
  const statusText = state.error ?? state.message;
  return (
    <ModelSelectorGroup
      heading={
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate">{state.label}</span>
          {state.loading ? (
            <LoaderCircle size={13} strokeWidth={1.75} className="animate-spin" />
          ) : null}
          {canConnect ? (
            <button
              type="button"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onManageProviders();
              }}
              className="ml-auto min-w-0 truncate text-2xs normal-case tracking-normal text-warn underline-offset-2 hover:underline"
            >
              Connect →
            </button>
          ) : (
            <span
              className={cn(
                "ml-auto min-w-0 truncate text-2xs normal-case tracking-normal",
                state.available ? "text-fg-mute" : "text-warn",
              )}
            >
              {statusText}
            </span>
          )}
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
              className="gap-2 py-2 font-mono text-xs"
            >
              <ModelSelectorName>{model.id}</ModelSelectorName>
              {model.description === "" ? null : (
                <ModelSelectorShortcut className="hidden max-w-48 truncate normal-case tracking-normal sm:inline">
                  {model.description}
                </ModelSelectorShortcut>
              )}
              {selected ? (
                <Check size={13} strokeWidth={1.75} className="ml-1 shrink-0 text-accent" />
              ) : null}
            </ModelSelectorItem>
          );
        })
      )}
    </ModelSelectorGroup>
  );
}

function PickerFooter({
  currentEffort,
  onReasoningEffortChange,
  onManageProviders,
}: {
  currentEffort: ChatReasoningEffort;
  onReasoningEffortChange(effort: ChatReasoningEffort): void;
  onManageProviders(): void;
}): React.ReactElement {
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2">
      <div className="flex min-w-0 items-center gap-2">
        <Brain
          size={14}
          strokeWidth={1.75}
          aria-label="Reasoning"
          className="shrink-0 text-fg-mute"
        />
        <div className="flex items-center gap-0.5 rounded-md bg-surface-2 p-0.5">
          {CHAT_REASONING_EFFORTS.map((effort) => {
            const selected = currentEffort === effort;
            return (
              <button
                key={effort}
                type="button"
                aria-pressed={selected}
                className={cn(
                  "rounded px-2 py-1 font-mono text-2xs transition-colors duration-100",
                  selected ? "bg-surface text-fg shadow-sm" : "text-fg-dim hover:text-fg",
                )}
                onClick={() => onReasoningEffortChange(effort)}
              >
                {REASONING_LABELS[effort]}
              </button>
            );
          })}
        </div>
      </div>
      <button
        type="button"
        onClick={onManageProviders}
        aria-label="Manage providers"
        title="Manage providers"
        className="shrink-0 text-fg-mute transition-colors hover:text-fg"
      >
        <Plug size={14} strokeWidth={1.75} />
      </button>
    </div>
  );
}

function providerShortLabel(provider: ChatModelChoice["provider"]): string {
  if (provider === "openai-codex") return "codex";
  if (provider === "anthropic-claude") return "claude";
  return "api";
}
