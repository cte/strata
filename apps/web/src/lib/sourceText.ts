/**
 * Display-time cleaning for raw source text that leaks into the actions UI.
 *
 * Source material (especially Slack) arrives with platform tokens that are
 * meaningless to a reader: HTML entities (`&gt;`), user/channel mentions
 * (`<@U…>`, `<#C…|name>`), angle-bracket links, and `:emoji_code:` shortcodes.
 * These helpers normalize that text for read-only display. They never mutate
 * stored data — editable inputs keep their raw values.
 */

const NAMED_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
  "&#39;": "'",
  "&nbsp;": " ",
};

function fromCodePointSafe(code: number): string {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) {
    return "";
  }
  try {
    return String.fromCodePoint(code);
  } catch {
    return "";
  }
}

/** Decode the small set of HTML entities Slack/markdown sources emit. */
export function decodeEntities(input: string): string {
  return input
    .replace(/&(?:amp|lt|gt|quot|apos|nbsp|#39);/g, (match) => NAMED_ENTITIES[match] ?? match)
    .replace(/&#(\d+);/g, (_match, code: string) => fromCodePointSafe(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_match, code: string) =>
      fromCodePointSafe(parseInt(code, 16)),
    );
}

/**
 * Turn raw source text into something readable: decode entities, resolve Slack
 * tokens to friendly `@name` / `#channel` / link-label forms, drop emoji
 * shortcodes, and collapse the whitespace that removal leaves behind.
 */
export function cleanSourceText(input: string): string {
  let text = decodeEntities(input);

  // Slack broadcast mentions: <!here>, <!channel>, <!everyone>.
  text = text.replace(/<!(here|channel|everyone)>/g, (_match, keyword: string) => `@${keyword}`);
  // User-group mentions: <!subteam^ID|name>.
  text = text.replace(/<!subteam\^[A-Z0-9]+(?:\|([^>]+))?>/g, (_match, name?: string) =>
    name ? `@${name}` : "@team",
  );
  // User mentions: <@U123> or <@U123|name>.
  text = text.replace(/<@[A-Z0-9]+(?:\|([^>]+))?>/g, (_match, name?: string) =>
    name ? `@${name}` : "@someone",
  );
  // Channel references: <#C123|name> or <#C123>.
  text = text.replace(/<#[A-Z0-9]+(?:\|([^>]+))?>/g, (_match, name?: string) =>
    name ? `#${name}` : "#channel",
  );
  // Links with a label: <https://x|label> -> label.
  text = text.replace(/<(?:https?:|mailto:)[^|>]+\|([^>]+)>/g, (_match, label: string) => label);
  // Bare links: <https://x> -> https://x.
  text = text.replace(/<((?:https?:|mailto:)[^>]+)>/g, (_match, url: string) => url);
  // Emoji shortcodes: drop whitespace/punctuation-delimited :word: tokens.
  // Requires a leading letter so clock times like 12:30 are left untouched.
  text = text.replace(
    /(^|[\s([{])(:[a-z][a-z0-9_+'-]*:)(?=[\s.,!?:;)\]}]|$)/gi,
    (_match, lead: string) => lead,
  );

  // Strip leading blockquote markers (`> quoted`) per line.
  text = text.replace(/^ *>+ ?/gm, "");
  // Unwrap Slack emphasis (*bold*, _italic_, ~strike~) when the marker hugs its
  // content. The edge guards avoid touching bullets ("* item"), arithmetic
  // ("2 * 3"), and snake_case identifiers.
  text = text.replace(/(^|[^\w*])\*(?! )([^*\n]+?)(?<! )\*(?![\w*])/g, "$1$2");
  text = text.replace(/(^|[^\w_])_(?! )([^_\n]+?)(?<! )_(?![\w_])/g, "$1$2");
  text = text.replace(/(^|[^\w~])~(?! )([^~\n]+?)(?<! )~(?![\w~])/g, "$1$2");

  // Collapse the gaps left by removals without flattening intentional newlines.
  return text
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ +\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Clean source context while preserving Markdown syntax for rendered previews.
 * Slack angle-bracket links are converted to Markdown links so context like
 * `<https://example.com|Thread>` remains clickable after rendering.
 */
export function cleanSourceMarkdown(input: string): string {
  let text = decodeEntities(input);

  text = text.replace(/<!(here|channel|everyone)>/g, (_match, keyword: string) => `@${keyword}`);
  text = text.replace(/<!subteam\^[A-Z0-9]+(?:\|([^>]+))?>/g, (_match, name?: string) =>
    name ? `@${name}` : "@team",
  );
  text = text.replace(/<@[A-Z0-9]+(?:\|([^>]+))?>/g, (_match, name?: string) =>
    name ? `@${name}` : "@someone",
  );
  text = text.replace(/<#[A-Z0-9]+(?:\|([^>]+))?>/g, (_match, name?: string) =>
    name ? `#${name}` : "#channel",
  );
  text = text.replace(
    /<((?:https?:|mailto:)[^|>]+)\|([^>]+)>/g,
    (_match, url: string, label: string) =>
      `[${escapeMarkdownLinkLabel(label)}](<${escapeMarkdownLinkDestination(url)}>)`,
  );
  text = text.replace(/<((?:https?:|mailto:)[^>]+)>/g, (_match, url: string) => url);
  text = text.replace(
    /(^|[\s([{])(:[a-z][a-z0-9_+'-]*:)(?=[\s.,!?:;)\]}]|$)/gi,
    (_match, lead: string) => lead,
  );

  return text
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ +\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function escapeMarkdownLinkLabel(value: string): string {
  return value.replace(/([\\[\]])/g, "\\$1");
}

function escapeMarkdownLinkDestination(value: string): string {
  return value.replace(/[<>]/g, "");
}

export type SourceKind = "slack" | "granola" | "notion" | "wiki" | "source";

const SOURCE_KIND_LABELS: Record<SourceKind, string> = {
  slack: "Slack",
  granola: "Granola",
  notion: "Notion",
  wiki: "Wiki",
  source: "Source",
};

/** Infer the originating connector from a source/path string. */
export function sourceKindFromPath(path: string): SourceKind {
  const lower = path.toLowerCase();
  if (/(^|\/)slack(\/|$)/.test(lower)) {
    return "slack";
  }
  if (/(^|\/)granola(\/|$)/.test(lower)) {
    return "granola";
  }
  if (/(^|\/)notion(\/|$)/.test(lower)) {
    return "notion";
  }
  if (/(^|\/)wiki(\/|$)/.test(lower) || lower.startsWith("wiki/")) {
    return "wiki";
  }
  return "source";
}

/** Human label for a source kind, e.g. "Slack". */
export function sourceKindLabel(kind: SourceKind): string {
  return SOURCE_KIND_LABELS[kind];
}

/**
 * A short, human source descriptor for a chip — the connector name rather than
 * the full opaque raw path (`wiki/raw/slack/2026-…-ship.md`). The full path
 * stays available via tooltip for provenance.
 */
export function shortSourceLabel(path: string, fallbackLabel?: string): string {
  const kind = sourceKindFromPath(path);
  if (kind !== "source") {
    return sourceKindLabel(kind);
  }
  const cleaned = fallbackLabel ? cleanSourceText(fallbackLabel).trim() : "";
  if (cleaned.length > 0) {
    return truncate(cleaned, 32);
  }
  return basename(path);
}

function basename(path: string): string {
  const trimmed = path.replace(/:\d+$/, "");
  const parts = trimmed.split("/");
  return parts[parts.length - 1] ?? path;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}
