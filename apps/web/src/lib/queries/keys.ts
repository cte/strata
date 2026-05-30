/**
 * Central query-key factory for the web control plane.
 *
 * Every React Query hook keys its cache through this object so that
 * invalidation stays consistent: mutating one domain invalidates the matching
 * `root` (or a narrower key) and all dependent queries refetch. Keys are plain
 * readonly tuples — `queryClient.invalidateQueries({ queryKey: qk.routines.root })`
 * invalidates every routines query because React Query matches by prefix.
 *
 * The chat surface keeps its own inline keys (`["chat", ...]`) because it is an
 * SSE-streamed special case (see `chatRunsStore`/`useChatRun`); do not fold it
 * in here.
 */
export const qk = {
  routines: {
    root: ["routines"] as const,
    list: (status: string) => ["routines", "list", status] as const,
    detail: (id: string) => ["routines", "detail", id] as const,
    runs: ["routines", "runs"] as const,
    artifacts: ["routines", "artifacts"] as const,
    triggers: (routineId: string) => ["routines", "triggers", routineId] as const,
  },
  system: {
    root: ["system"] as const,
    retrievalIndex: ["system", "retrieval-index"] as const,
  },
  connectors: {
    root: ["connectors"] as const,
    list: ["connectors", "list"] as const,
    granolaStatus: ["connectors", "granola", "status"] as const,
    notionMcpStatus: ["connectors", "notion", "mcp", "status"] as const,
    configProfiles: (connector: string) => ["connectors", "config", connector] as const,
  },
  activity: {
    root: ["activity"] as const,
    list: (source: string, resultKey: string) => ["activity", "list", source, resultKey] as const,
    detail: (sessionId: string, resultKey: string) =>
      ["activity", "detail", sessionId, resultKey] as const,
  },
  proposals: {
    root: ["proposals"] as const,
    list: (status: string) => ["proposals", "list", status] as const,
    detail: (id: string) => ["proposals", "detail", id] as const,
  },
  wiki: {
    root: ["wiki"] as const,
    tree: (includeRaw: boolean) => ["wiki", "tree", includeRaw] as const,
    page: (path: string) => ["wiki", "page", path] as const,
    actions: ["wiki", "actions"] as const,
  },
  taxonomy: {
    root: ["ingest", "taxonomy"] as const,
  },
  mcps: {
    root: ["mcps"] as const,
    status: ["mcps", "status"] as const,
    tools: (slug: string) => ["mcps", "tools", slug] as const,
  },
} as const;
