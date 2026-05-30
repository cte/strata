import { useQuery } from "@tanstack/react-query";
import { getWikiPage, getWikiTree, type WikiPageDetail, type WikiTreeEntry } from "@/lib/api";
import { qk } from "./keys";

export function useWikiTree(includeRaw = false) {
  return useQuery<WikiTreeEntry[]>({
    queryKey: qk.wiki.tree(includeRaw),
    queryFn: () => getWikiTree(includeRaw),
  });
}

/** Dependent fetch: only runs once a tree entry is selected. */
export function useWikiPage(path: string | null, includeRaw = false) {
  return useQuery<WikiPageDetail>({
    queryKey: qk.wiki.page(path ?? ""),
    queryFn: () => getWikiPage(path as string, includeRaw),
    enabled: path !== null,
  });
}
