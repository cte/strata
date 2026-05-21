import { Bot, ChevronDown, LoaderCircle } from "lucide-react";
import type * as React from "react";
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
    <div className="relative">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={disabled}
        aria-expanded={open}
        aria-label="Choose model"
        title="Choose model"
        onClick={() => onOpenChange(!open)}
        className="h-7 max-w-full justify-start gap-1.5 px-2 font-mono text-[11px] text-[var(--fg-dim)]"
      >
        <Bot size={13} strokeWidth={1.75} className="shrink-0 text-[var(--accent)]" />
        <span className="truncate">
          {choice === null ? "model" : `${providerShortLabel(choice.provider)}:${choice.model}`}
        </span>
        {choice === null || currentEffort === "off" ? null : (
          <span className="shrink-0 text-[var(--fg-mute)]">/{REASONING_LABELS[currentEffort]}</span>
        )}
        <ChevronDown
          size={12}
          strokeWidth={1.75}
          className={cn("shrink-0 transition-transform", open && "rotate-180")}
        />
      </Button>
      {open ? (
        <div className="absolute bottom-full left-0 z-40 mb-2 w-[min(620px,calc(100vw-2rem))] overflow-hidden rounded-md border border-[var(--hairline-strong)] bg-[var(--surface)] shadow-2xl shadow-black/35">
          <div className="max-h-[360px] overflow-y-auto p-2">
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
          </div>
          <div className="border-t border-[var(--hairline)] p-2">
            <div className="mb-1.5 text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--fg-mute)]">
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
        </div>
      ) : null}
    </div>
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
    <section className="border-t border-[var(--hairline)] py-2 first:border-t-0 first:pt-0 last:pb-0">
      <div className="mb-1.5 flex min-w-0 items-center justify-between gap-3 px-1">
        <div className="min-w-0">
          <div className="truncate text-[12px] font-medium text-[var(--fg)]">{state.label}</div>
          <div
            className={cn(
              "truncate text-[11px]",
              state.available ? "text-[var(--fg-mute)]" : "text-[var(--warn)]",
            )}
          >
            {state.error ?? state.message}
          </div>
        </div>
        {state.loading ? (
          <LoaderCircle
            size={13}
            strokeWidth={1.75}
            className="shrink-0 animate-spin text-[var(--fg-mute)]"
          />
        ) : null}
      </div>
      {!state.available ? null : state.models.length === 0 && !state.loading ? (
        <div className="px-1 py-1.5 text-[11.5px] text-[var(--fg-mute)]">No models returned.</div>
      ) : (
        <div className="grid gap-1">
          {state.models.slice(0, 24).map((model) => {
            const selected = choice?.provider === state.provider && choice.model === model.id;
            return (
              <button
                key={`${state.provider}:${model.id}`}
                type="button"
                className={cn(
                  "flex min-w-0 items-center gap-2 rounded px-2 py-1.5 text-left transition-colors duration-100",
                  selected
                    ? "bg-[var(--accent-soft)] text-[var(--fg)]"
                    : "text-[var(--fg-dim)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)]",
                )}
                onClick={() => onSelect(model.id)}
              >
                <span className="min-w-0 flex-1 truncate font-mono text-[12px]">{model.id}</span>
                {model.description === "" ? null : (
                  <span className="hidden max-w-40 shrink-0 truncate text-[11px] text-[var(--fg-mute)] sm:inline">
                    {model.description}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

function providerShortLabel(provider: ChatModelChoice["provider"]): string {
  return provider === "openai-codex" ? "codex" : "api";
}
