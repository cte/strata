import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { type ChatSessionSummary, listChatSessions, searchChatSessions } from "@/lib/api";

export interface UseChatSessionsResult {
  searchQuery: string;
  setSearchQuery(value: string): void;
  sessions: ChatSessionSummary[];
  isLoaded: boolean;
  error: unknown;
  refresh(): void;
}

const SEARCH_DEBOUNCE_MS = 180;

export function useChatSessions(): UseChatSessionsResult {
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState("");

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timeout);
  }, [searchQuery]);

  const trimmedSearch = debouncedSearchQuery.trim();
  const sessionsQuery = useQuery<ChatSessionSummary[]>({
    queryKey: ["chat", "sessions", { search: trimmedSearch }],
    queryFn: () =>
      trimmedSearch === "" ? listChatSessions(40) : searchChatSessions(trimmedSearch, 40),
  });

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["chat", "sessions"] });
  }, [queryClient]);

  return {
    searchQuery,
    setSearchQuery,
    sessions: sessionsQuery.data ?? [],
    isLoaded: !sessionsQuery.isPending,
    error: sessionsQuery.error,
    refresh,
  };
}
