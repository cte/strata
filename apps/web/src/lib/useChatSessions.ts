import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { type ChatSessionSummary, listChatSessions } from "@/lib/api";
import { CHAT_SESSION_INDEX_LIMIT, filterChatSessionsClientSide } from "@/lib/chatSessionSearch";

export interface UseChatSessionsResult {
  searchQuery: string;
  setSearchQuery(value: string): void;
  sessions: ChatSessionSummary[];
  isLoaded: boolean;
  error: unknown;
  refresh(): void;
}

export function useChatSessions(): UseChatSessionsResult {
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");
  const sessionsQuery = useQuery<ChatSessionSummary[]>({
    queryKey: ["chat", "sessions", "index"],
    queryFn: () => listChatSessions(CHAT_SESSION_INDEX_LIMIT),
  });
  const sessions = useMemo(
    () => filterChatSessionsClientSide(sessionsQuery.data ?? [], searchQuery),
    [searchQuery, sessionsQuery.data],
  );

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["chat", "sessions"] });
  }, [queryClient]);

  return {
    searchQuery,
    setSearchQuery,
    sessions,
    isLoaded: !sessionsQuery.isPending,
    error: sessionsQuery.error,
    refresh,
  };
}
