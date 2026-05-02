import { describe, expect, test } from "bun:test";
import { ChatGptLoginCancelled, loginChatGpt } from "./chatgptOAuth.js";

describe("loginChatGpt", () => {
  test("aborting the signal rejects with ChatGptLoginCancelled", async () => {
    const controller = new AbortController();
    const promise = loginChatGpt({
      onAuth: () => {
        // Cancel as soon as the URL is presented; the manual-input wait will be aborted.
        setTimeout(() => controller.abort(), 0);
      },
      onPrompt: () => new Promise<string>(() => {}),
      onManualCodeInput: () => new Promise<string>(() => {}),
      signal: controller.signal,
    });

    await expect(promise).rejects.toBeInstanceOf(ChatGptLoginCancelled);
  });
});
