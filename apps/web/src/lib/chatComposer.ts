import type { ChatRunState } from "@/lib/chatRunModel";

export type ComposerSubmitStatus = "submitted" | "streaming";

export interface ChatComposerSubmitState {
  disabled: boolean;
  status?: ComposerSubmitStatus;
}

export function chatComposerSubmitState(input: {
  prompt: string;
  attachmentCount: number;
  runState: ChatRunState;
  externallyRunning: boolean;
}): ChatComposerSubmitState {
  const hasDraft = input.prompt.trim() !== "" || input.attachmentCount > 0;
  const isRunning = input.runState !== "idle";
  const disabled =
    input.runState === "cancelling" || input.externallyRunning || (!isRunning && !hasDraft);

  // While a local run is active, a non-empty composer should still submit the
  // draft so ChatPage can enqueue it. Only show the stop affordance when there
  // is no draft to queue.
  const status = isRunning && !hasDraft ? chatComposerRunStatus(input.runState) : undefined;
  return status === undefined ? { disabled } : { disabled, status };
}

export function chatComposerRunStatus(runState: ChatRunState): ComposerSubmitStatus | undefined {
  if (runState === "starting") {
    return "submitted";
  }
  if (runState === "streaming" || runState === "disconnected" || runState === "cancelling") {
    return "streaming";
  }
  return undefined;
}
