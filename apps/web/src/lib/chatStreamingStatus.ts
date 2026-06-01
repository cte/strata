export function formatRunElapsed(
  startedAt: string | null | undefined,
  nowMs = Date.now(),
): string | null {
  if (startedAt === null || startedAt === undefined) {
    return null;
  }
  const startedMs = Date.parse(startedAt);
  if (!Number.isFinite(startedMs)) {
    return null;
  }
  const totalSeconds = Math.max(0, Math.floor((nowMs - startedMs) / 1000));
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}
