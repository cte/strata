import fuzzysort from "fuzzysort";
import type { ChatSessionSummary } from "@/lib/api";

export const CHAT_SESSION_INDEX_LIMIT = 500;
export const CHAT_SESSION_RESULT_LIMIT = 40;

type ChatSessionSearchResult = Fuzzysort.KeysResult<ChatSessionSummary>;

const TITLE_KEY_INDEX = 0;
const ID_KEY_INDEX = 1;
const MODEL_KEY_INDEX = 2;
const STATUS_KEY_INDEX = 3;
const STARTED_AT_KEY_INDEX = 4;

export function filterChatSessionsClientSide(
  sessions: ChatSessionSummary[],
  query: string,
  limit = CHAT_SESSION_RESULT_LIMIT,
): ChatSessionSummary[] {
  const trimmedQuery = query.trim();
  if (trimmedQuery === "") {
    return sessions.slice(0, limit);
  }
  return fuzzysort
    .go(trimmedQuery, sessions, {
      keys: [
        (session) => session.title,
        (session) => session.id,
        (session) => session.model ?? "",
        (session) => session.status,
        (session) => session.startedAt,
      ],
      limit,
      threshold: 0.35,
      scoreFn: scoreChatSessionSearchResult,
    })
    .map((result) => result.obj);
}

function scoreChatSessionSearchResult(result: ChatSessionSearchResult): number {
  return Math.max(
    scoreKey(result, TITLE_KEY_INDEX),
    scoreKey(result, ID_KEY_INDEX) * 0.95,
    scoreKey(result, MODEL_KEY_INDEX) * 0.85,
    scoreKey(result, STATUS_KEY_INDEX) * 0.65,
    scoreKey(result, STARTED_AT_KEY_INDEX) * 0.55,
  );
}

function scoreKey(result: ChatSessionSearchResult, index: number): number {
  return result[index]?.score ?? 0;
}
