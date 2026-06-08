import { Brain, Check, ChevronDown, LoaderCircle, Plug } from "lucide-react";
import type * as React from "react";
import { useMemo, useState } from "react";
import {
  ModelSelector,
  ModelSelectorCollection,
  ModelSelectorCommand,
  ModelSelectorContent,
  ModelSelectorEmpty,
  ModelSelectorGroup,
  ModelSelectorGroupLabel,
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

// One selectable model in the combobox. The `value` object is what Base UI
// filters and selects on; `search` is the string used for substring matching.
interface ModelItem {
  provider: ChatProviderModelState["provider"];
  id: string;
  description: string;
  search: string;
  selected: boolean;
}

// A provider group: its header (label/status/connect) plus its filtered models.
interface ModelGroup {
  state: ChatProviderModelState;
  items: ModelItem[];
}

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

  const groups = useMemo<ModelGroup[]>(
    () =>
      providerStates.map((state) => ({
        state,
        items: !state.available
          ? []
          : state.models.map((model) => ({
              provider: state.provider,
              id: model.id,
              description: model.description,
              search: `${state.label} ${state.provider} ${model.id} ${model.description}`,
              selected: choice?.provider === state.provider && choice.model === model.id,
            })),
      })),
    [providerStates, choice],
  );

  return (
    <>
      <ModelSelector open={open} onOpenChange={onOpenChange}>
        <ModelSelectorTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={disabled}
              aria-label="Choose model"
              title="Choose model"
              className="h-7 max-w-full justify-start gap-1.5 px-2 font-mono text-xs text-fg-dim [&>svg]:!size-[13px]"
            />
          }
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
        </ModelSelectorTrigger>
        <ModelSelectorContent
          title="Choose model"
          className="w-[min(680px,calc(100vw-2rem))] overflow-hidden rounded-lg border border-hairline-strong bg-surface text-fg shadow-2xl shadow-black/45"
        >
          <ModelSelectorCommand<ModelItem>
            items={groups}
            itemToStringLabel={(item) => item.search}
            onValueChange={(item) => {
              if (item === null) {
                return;
              }
              onSelect({
                provider: item.provider,
                model: item.id,
                reasoningEffort: currentEffort,
              });
              onOpenChange(false);
            }}
          >
            <ModelSelectorInput placeholder="Search models..." />
            <ModelSelectorList<ModelGroup> className="max-h-[min(420px,60dvh)]">
              {(group) => (
                <ProviderModelGroup
                  key={group.state.provider}
                  group={group}
                  onManageProviders={openProviderAuth}
                />
              )}
            </ModelSelectorList>
            <ModelSelectorEmpty>No models found.</ModelSelectorEmpty>
            <ModelSelectorSeparator />
            <PickerFooter
              currentEffort={currentEffort}
              onReasoningEffortChange={onReasoningEffortChange}
              onManageProviders={openProviderAuth}
            />
          </ModelSelectorCommand>
        </ModelSelectorContent>
      </ModelSelector>
      <ModelAuthDialog open={authOpen} onOpenChange={setAuthOpen} />
    </>
  );
}

function ProviderModelGroup({
  group,
  onManageProviders,
}: {
  group: ModelGroup;
  onManageProviders(): void;
}): React.ReactElement {
  const { state } = group;
  // openai-compatible auth is an env API key, not OAuth — no connect action.
  const canConnect = !state.available && state.provider !== "openai-compatible";
  const statusText = state.error ?? state.message;
  return (
    <ModelSelectorGroup items={group.items}>
      <ModelSelectorGroupLabel className="flex min-w-0 items-center gap-2 normal-case tracking-normal">
        <span className="truncate text-fg-mute">{state.label}</span>
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
            className="ml-auto min-w-0 truncate text-2xs text-warn underline-offset-2 hover:underline"
          >
            Connect →
          </button>
        ) : (
          <span
            className={cn(
              "ml-auto min-w-0 truncate text-2xs",
              state.available ? "text-fg-mute" : "text-warn",
            )}
          >
            {statusText}
          </span>
        )}
      </ModelSelectorGroupLabel>
      {!state.available ? null : state.models.length === 0 && !state.loading ? (
        <ModelSelectorItem disabled>No models returned.</ModelSelectorItem>
      ) : (
        <ModelSelectorCollection<ModelItem>>
          {(item) => (
            <ModelSelectorItem
              key={`${item.provider}:${item.id}`}
              value={item}
              className="gap-2 py-2 font-mono text-xs"
            >
              <ModelSelectorName>{item.id}</ModelSelectorName>
              {item.description === "" ? null : (
                <ModelSelectorShortcut className="hidden max-w-48 truncate normal-case tracking-normal sm:inline">
                  {item.description}
                </ModelSelectorShortcut>
              )}
              {item.selected ? (
                <Check size={13} strokeWidth={1.75} className="ml-1 shrink-0 text-accent" />
              ) : null}
            </ModelSelectorItem>
          )}
        </ModelSelectorCollection>
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
