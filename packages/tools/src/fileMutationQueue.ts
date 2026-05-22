import { realpathSync } from "node:fs";
import path from "node:path";

const fileMutationQueues = new Map<string, Promise<void>>();

function mutationQueueKey(filePath: string): string {
  const resolved = path.resolve(filePath);
  try {
    return realpathSync.native(resolved);
  } catch {
    return resolved;
  }
}

/**
 * Serialize file mutation operations targeting the same file.
 * Operations for different files still run in parallel.
 */
export async function withFileMutationQueue<T>(
  filePath: string,
  operation: () => Promise<T>,
): Promise<T> {
  const key = mutationQueueKey(filePath);
  const currentQueue = fileMutationQueues.get(key) ?? Promise.resolve();

  let releaseNext!: () => void;
  const nextQueue = new Promise<void>((resolve) => {
    releaseNext = resolve;
  });
  const chainedQueue = currentQueue.then(() => nextQueue);
  fileMutationQueues.set(key, chainedQueue);

  await currentQueue;
  try {
    return await operation();
  } finally {
    releaseNext();
    if (fileMutationQueues.get(key) === chainedQueue) {
      fileMutationQueues.delete(key);
    }
  }
}
