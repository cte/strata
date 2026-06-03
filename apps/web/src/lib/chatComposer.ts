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
  compacting?: boolean;
}): ChatComposerSubmitState {
  const hasDraft = input.prompt.trim() !== "" || input.attachmentCount > 0;
  const isRunning = input.runState !== "idle";
  const busy = input.externallyRunning || input.compacting === true;
  const disabled = input.runState === "cancelling" || busy || (!isRunning && !hasDraft);

  // While a local run is active, a non-empty composer should still submit the
  // draft so ChatPage can enqueue it. Only show the stop affordance when there
  // is no draft to queue. Manual compaction disables the composer but must not
  // show a stop button because there is no chat run to cancel.
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
