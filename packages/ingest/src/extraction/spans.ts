import { createHash } from "node:crypto";
import type { EvidenceSpan, WikiCorpusDocument } from "./types.js";

interface SlackMessageBlock {
  speaker: string;
  messageTs: string;
  lineStart: number;
  lineEnd: number;
  text: string;
}

export function evidenceSpansForDocument(document: WikiCorpusDocument): EvidenceSpan[] {
  if (document.sourceType === "slack" && document.sourceKind === "raw") {
    return slackEvidenceSpans(document);
  }
  return markdownEvidenceSpans(document);
}

export function evidenceSpansForDocuments(documents: WikiCorpusDocument[]): EvidenceSpan[] {
  return documents.flatMap((document) => evidenceSpansForDocument(document));
}

function slackEvidenceSpans(document: WikiCorpusDocument): EvidenceSpan[] {
  return slackMessageBlocks(document.body).map((message) => {
    const lineStart = document.bodyLineStart + message.lineStart - 1;
    const lineEnd = document.bodyLineStart + message.lineEnd - 1;
    const metadata = {
      title: document.title,
      speaker: message.speaker,
      messageTs: message.messageTs,
      channel: document.frontmatter.channel ?? "",
      threadTs: document.frontmatter.thread_ts ?? "",
      latestTs: document.frontmatter.latest_ts ?? "",
      speakerKind: slackSpeakerKind(message.speaker),
    };
    return {
      id: spanId(document.path, message.lineStart, message.lineEnd, message.text),
      sourcePath: document.path,
      sourceKind: document.sourceKind,
      sourceType: document.sourceType,
      date: document.date,
      lineStart,
      lineEnd,
      text: normalizeSpanText(message.text),
      contextText: normalizeSpanText(message.text),
      metadata,
    };
  });
}

function markdownEvidenceSpans(document: WikiCorpusDocument): EvidenceSpan[] {
  const spans: EvidenceSpan[] = [];
  const lines = document.body.split(/\r?\n/);
  let current: { start: number; lines: string[] } | null = null;
  let activeSection = "";

  const flush = (endLine: number) => {
    if (current === null) {
      return;
    }
    const text = normalizeSpanText(current.lines.join(" "));
    if (text !== "" && !isMetadataOnlyLine(text)) {
      spans.push({
        id: spanId(document.path, current.start, endLine, text),
        sourcePath: document.path,
        sourceKind: document.sourceKind,
        sourceType: document.sourceType,
        date: document.date,
        lineStart: document.bodyLineStart + current.start - 1,
        lineEnd: document.bodyLineStart + endLine - 1,
        text,
        contextText: text,
        metadata: markdownSpanMetadata(document, activeSection),
      });
    }
    current = null;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index] ?? "";
    const lineNumber = index + 1;
    const line = rawLine.trim();
    const heading = /^#{1,6}\s+(.+)$/.exec(line);
    if (heading) {
      flush(lineNumber - 1);
      activeSection = heading[1]?.trim() ?? "";
      continue;
    }
    if (line === "") {
      flush(lineNumber - 1);
      continue;
    }
    if (isIgnoredSection(activeSection)) {
      continue;
    }
    if (/^(?:[-*]\s+|\d+\.\s+)/.test(line)) {
      flush(lineNumber - 1);
      const text = normalizeSpanText(line);
      if (text !== "" && !isMetadataOnlyLine(text)) {
        spans.push({
          id: spanId(document.path, lineNumber, lineNumber, text),
          sourcePath: document.path,
          sourceKind: document.sourceKind,
          sourceType: document.sourceType,
          date: document.date,
          lineStart: document.bodyLineStart + lineNumber - 1,
          lineEnd: document.bodyLineStart + lineNumber - 1,
          text,
          contextText: text,
          metadata: markdownSpanMetadata(document, activeSection),
        });
      }
      continue;
    }
    if (current === null) {
      current = { start: lineNumber, lines: [line] };
    } else {
      current.lines.push(line);
    }
  }
  flush(lines.length);

  return spans;
}

function slackMessageBlocks(body: string): SlackMessageBlock[] {
  const messages: SlackMessageBlock[] = [];
  const lines = body.split(/\r?\n/);
  let current: { speaker: string; messageTs: string; lineStart: number; lines: string[] } | null =
    null;

  const flush = (lineEnd: number) => {
    if (current === null) {
      return;
    }
    const text = normalizeSpanText(
      current.lines.filter((line) => !/^reactions?:/i.test(line.trim())).join(" "),
    );
    if (text !== "" && !/^_?no text_?$/i.test(text)) {
      messages.push({
        speaker: current.speaker,
        messageTs: current.messageTs,
        lineStart: current.lineStart,
        lineEnd,
        text,
      });
    }
    current = null;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const heading = /^##\s+([0-9.]+)\s+\|\s+(.+)$/.exec(line);
    if (heading) {
      flush(index);
      current = {
        messageTs: heading[1] ?? "",
        speaker: heading[2]?.trim() ?? "",
        lineStart: index + 2,
        lines: [],
      };
      continue;
    }
    if (line.startsWith("#")) {
      continue;
    }
    current?.lines.push(line);
  }
  flush(lines.length);
  return messages;
}

function markdownSpanMetadata(
  document: WikiCorpusDocument,
  section: string,
): Record<string, string> {
  return {
    title: document.title,
    section,
    canonicalSourcePath: canonicalSourcePathForDocument(document),
  };
}

function canonicalSourcePathForDocument(document: WikiCorpusDocument): string {
  const source = document.frontmatter.source?.trim();
  if (
    source !== undefined &&
    source !== "" &&
    (source.startsWith("raw/") || source.startsWith("sources/") || source.startsWith("wiki/"))
  ) {
    return source.startsWith("wiki/") ? source : `wiki/${source}`;
  }
  return document.path;
}

function normalizeSpanText(value: string): string {
  return value
    .replace(/^[-*]\s+/, "")
    .replace(/^\d+\.\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isIgnoredSection(section: string): boolean {
  return /^(source|timeline|projects|decisions|promoted threads)$/i.test(section.trim());
}

function isMetadataOnlyLine(text: string): boolean {
  return (
    /^none indexed\.?$/i.test(text) || /^raw source:/i.test(text) || /^raw transcript:/i.test(text)
  );
}

function slackSpeakerKind(speaker: string): "person" | "user_id" | "bot_or_app" | "unknown" {
  if (/^U[A-Z0-9]+$/.test(speaker)) {
    return "user_id";
  }
  if (/\b(bot|metabot|automation|worker|agent|app)\b/i.test(speaker)) {
    return "bot_or_app";
  }
  if (looksLikePersonName(speaker)) {
    return "person";
  }
  return "unknown";
}

function looksLikePersonName(value: string): boolean {
  if (value === "" || value.includes("@")) {
    return false;
  }
  return value.split(/\s+/).every((part) => /^[A-Z][A-Za-z.'-]*$/.test(part));
}

function spanId(sourcePath: string, lineStart: number, lineEnd: number, text: string): string {
  return `span_${hash(`${sourcePath}:${lineStart}:${lineEnd}:${text}`)}`;
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 20);
}
