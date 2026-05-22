import { describe, expect, test } from "bun:test";
import path from "node:path";
import { withFileMutationQueue } from "./fileMutationQueue.js";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("withFileMutationQueue", () => {
  test("serializes mutations targeting the same file", async () => {
    const filePath = path.join(process.cwd(), ".strata-test-file");
    const events: string[] = [];
    let releaseFirst: (() => void) | undefined;
    const firstCanFinish = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = withFileMutationQueue(filePath, async () => {
      events.push("first:start");
      await firstCanFinish;
      events.push("first:end");
    });
    const second = withFileMutationQueue(filePath, async () => {
      events.push("second:start");
      events.push("second:end");
    });

    await delay(10);
    expect(events).toEqual(["first:start"]);
    releaseFirst?.();
    await Promise.all([first, second]);

    expect(events).toEqual(["first:start", "first:end", "second:start", "second:end"]);
  });
});
