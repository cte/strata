export interface SlackMessage {
  speaker: string;
  text: string;
  line: number;
}

export function slackMessageTexts(body: string): string[] {
  return slackMessages(body).map((message) => message.text);
}

export function slackMessages(body: string): SlackMessage[] {
  const messages: SlackMessage[] = [];
  let speaker = "";
  let startLine = 1;
  let current: string[] = [];
  const flush = () => {
    const text = current
      .map((line) => line.trim())
      .filter((line) => line !== "" && !/^reactions?:/i.test(line))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (text !== "") {
      messages.push({ speaker, text, line: startLine });
    }
    current = [];
  };
  const lines = body.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const heading = /^##\s+\d+\.\d+\s+\|\s+(.+)$/.exec(line);
    if (heading) {
      flush();
      speaker = heading[1]?.trim() ?? "";
      startLine = index + 2;
      continue;
    }
    if (line.startsWith("#")) {
      continue;
    }
    current.push(line);
  }
  flush();
  return messages;
}

export function slackParticipantsFromHeadings(body: string): string[] {
  return uniqueStrings(
    [...body.matchAll(/^##\s+\d+\.\d+\s+\|\s+(.+)$/gm)].map((match) => {
      return (match[1] ?? "").trim();
    }),
  );
}

function uniqueStrings(items: string[]): string[] {
  const seen = new Set<string>();
  const result = [];
  for (const item of items) {
    const normalized = item.trim().replace(/\s+/g, " ");
    if (normalized === "" || seen.has(normalized.toLowerCase())) {
      continue;
    }
    seen.add(normalized.toLowerCase());
    result.push(normalized);
  }
  return result;
}
