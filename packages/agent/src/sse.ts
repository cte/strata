/**
 * SSE framing parser shared by streaming model adapters. Given a fetch
 * `Response`, yields each `data:` event payload parsed as JSON. Lines that
 * are not `data:`, the `[DONE]` sentinel, and empty payloads are skipped.
 */
export async function* parseSseEvents<T>(response: Response): AsyncGenerator<T> {
  const reader = response.body?.getReader();
  if (reader === undefined) {
    return;
  }
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      let separator = buffer.indexOf("\n\n");
      while (separator !== -1) {
        const chunk = buffer.slice(0, separator);
        buffer = buffer.slice(separator + 2);
        const data = chunk
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trim())
          .join("\n")
          .trim();
        if (data !== "" && data !== "[DONE]") {
          yield JSON.parse(data) as T;
        }
        separator = buffer.indexOf("\n\n");
      }
    }
  } finally {
    reader.releaseLock();
  }
}
