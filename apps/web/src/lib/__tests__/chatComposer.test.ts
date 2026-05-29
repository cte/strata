import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { chatComposerSubmitState } from "@/lib/chatComposer";

describe("chat composer submit state", () => {
  test("keeps an empty idle composer disabled", () => {
    assert.deepEqual(
      chatComposerSubmitState({
        prompt: "",
        attachmentCount: 0,
        runState: "idle",
        externallyRunning: false,
      }),
      { disabled: true },
    );
  });

  test("shows stop while a local run is active and no draft is queued", () => {
    assert.deepEqual(
      chatComposerSubmitState({
        prompt: "",
        attachmentCount: 0,
        runState: "streaming",
        externallyRunning: false,
      }),
      { disabled: false, status: "streaming" },
    );
  });

  test("allows submitting a typed draft during a local run so it can be queued", () => {
    assert.deepEqual(
      chatComposerSubmitState({
        prompt: "follow up",
        attachmentCount: 0,
        runState: "streaming",
        externallyRunning: false,
      }),
      { disabled: false },
    );
  });

  test("allows submitting attachments during a local run so they can be queued", () => {
    assert.deepEqual(
      chatComposerSubmitState({
        prompt: "",
        attachmentCount: 1,
        runState: "starting",
        externallyRunning: false,
      }),
      { disabled: false },
    );
  });

  test("locks the composer for externally running sessions", () => {
    assert.deepEqual(
      chatComposerSubmitState({
        prompt: "follow up",
        attachmentCount: 0,
        runState: "idle",
        externallyRunning: true,
      }),
      { disabled: true },
    );
  });
});
