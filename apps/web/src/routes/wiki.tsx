import { ChevronDown, ChevronRight, FileText, Folder, FolderOpen } from "lucide-react";
import type * as React from "react";
import { useCallback, useMemo, useState } from "react";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import { PageContainer, PageHeader } from "@/components/page-layout";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import type { WikiPageDetail, WikiTreeEntry } from "@/lib/api";
import { useWikiPage, useWikiTree } from "@/lib/queries/wiki";
import { cn } from "@/lib/utils";

export function WikiPage(): React.ReactElement {
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  const treeQuery = useWikiTree();
  const pageQuery = useWikiPage(selectedPath);

  const tree = useMemo<WikiTreeEntry[]>(() => treeQuery.data ?? [], [treeQuery.data]);
  const treeLoaded = !treeQuery.isPending;
  const treeError = treeQuery.error ? messageOf(treeQuery.error) : null;
  const page = pageQuery.data ?? null;
  const pageLoading = selectedPath !== null && pageQuery.isFetching;
  const pageError = pageQuery.error ? messageOf(pageQuery.error) : null;

  const initialOpenPaths = useMemo(() => defaultOpenPaths(tree), [tree]);

  const handleSelectPage = useCallback((path: string) => {
    setSelectedPath(path);
  }, []);

  return (
    <PageContainer width="wide" fill>
      <PageHeader
        title="Wiki"
        description="Browse the local Markdown tree and preview pages without leaving the web app."
      />

      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden rounded-xl border border-hairline bg-surface lg:grid-cols-[minmax(260px,340px)_minmax(0,1fr)]">
        <aside className="min-h-0 border-b border-hairline bg-bg lg:border-r lg:border-b-0">
          <ScrollArea className="h-full">
            <div className="flex flex-col gap-2 p-3">
              <div className="label-eyebrow px-2 text-fg-mute">wiki tree</div>
              {treeError ? (
                <p className="rounded-md border border-bad/40 bg-bad/[0.06] p-3 font-mono text-xs text-bad">
                  {treeError}
                </p>
              ) : !treeLoaded ? (
                <WikiTreeSkeleton />
              ) : tree.length === 0 ? (
                <p className="px-2 py-3 text-sm text-fg-dim">No Markdown pages found.</p>
              ) : (
                <WikiTree
                  entries={tree}
                  initialOpenPaths={initialOpenPaths}
                  selectedPath={selectedPath}
                  onSelectPage={handleSelectPage}
                />
              )}
            </div>
          </ScrollArea>
        </aside>

        <section className="min-h-0 min-w-0 bg-bg">
          <ScrollArea className="h-full">
            <div className="mx-auto max-w-4xl p-4 md:p-8">
              <WikiMarkdownViewer
                page={page}
                loading={pageLoading}
                error={pageError}
                selectedPath={selectedPath}
              />
            </div>
          </ScrollArea>
        </section>
      </div>
    </PageContainer>
  );
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function WikiTree({
  entries,
  initialOpenPaths,
  selectedPath,
  onSelectPage,
}: {
  entries: WikiTreeEntry[];
  initialOpenPaths: Set<string>;
  selectedPath: string | null;
  onSelectPage(path: string): void;
}): React.ReactElement {
  const [openPaths, setOpenPaths] = useState<Set<string>>(initialOpenPaths);

  const togglePath = useCallback((path: string) => {
    setOpenPaths((current) => {
      const next = new Set(current);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  return (
    <ul className="flex flex-col gap-0.5">
      {entries.map((entry) => (
        <WikiTreeRow
          key={entry.path}
          entry={entry}
          depth={0}
          openPaths={openPaths}
          selectedPath={selectedPath}
          onSelectPage={onSelectPage}
          onTogglePath={togglePath}
        />
      ))}
    </ul>
  );
}

function WikiTreeRow({
  entry,
  depth,
  openPaths,
  selectedPath,
  onSelectPage,
  onTogglePath,
}: {
  entry: WikiTreeEntry;
  depth: number;
  openPaths: Set<string>;
  selectedPath: string | null;
  onSelectPage(path: string): void;
  onTogglePath(path: string): void;
}): React.ReactElement {
  const isDirectory = entry.type === "directory";
  const isOpen = isDirectory && openPaths.has(entry.path);
  const isSelected = selectedPath === entry.path;
  const children = entry.children ?? [];

  return (
    <li>
      <button
        type="button"
        onClick={() => (isDirectory ? onTogglePath(entry.path) : onSelectPage(entry.path))}
        className={cn(
          "flex w-full min-w-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm transition-colors duration-150 hover:bg-surface-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          isSelected ? "bg-accent-soft text-fg" : "text-fg-dim",
        )}
        style={{ paddingLeft: `${8 + depth * 14}px` }}
      >
        {isDirectory ? (
          isOpen ? (
            <ChevronDown aria-hidden="true" className="size-3 shrink-0" />
          ) : (
            <ChevronRight aria-hidden="true" className="size-3 shrink-0" />
          )
        ) : (
          <span aria-hidden="true" className="size-3 shrink-0" />
        )}
        {isDirectory ? (
          isOpen ? (
            <FolderOpen aria-hidden="true" className="size-3.5 shrink-0" />
          ) : (
            <Folder aria-hidden="true" className="size-3.5 shrink-0" />
          )
        ) : (
          <FileText aria-hidden="true" className="size-3.5 shrink-0" />
        )}
        <span className="truncate">{entry.name}</span>
      </button>
      {isOpen && children.length > 0 ? (
        <ul className="mt-0.5 flex flex-col gap-0.5">
          {children.map((child) => (
            <WikiTreeRow
              key={child.path}
              entry={child}
              depth={depth + 1}
              openPaths={openPaths}
              selectedPath={selectedPath}
              onSelectPage={onSelectPage}
              onTogglePath={onTogglePath}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function WikiMarkdownViewer({
  page,
  loading,
  error,
  selectedPath,
}: {
  page: WikiPageDetail | null;
  loading: boolean;
  error: string | null;
  selectedPath: string | null;
}): React.ReactElement {
  if (selectedPath === null) {
    return (
      <Empty className="min-h-[360px] justify-center">
        <EmptyHeader>
          <EmptyTitle>Select a wiki page</EmptyTitle>
          <EmptyDescription>
            Choose a Markdown file from the tree to render it inline.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  if (loading) {
    return <MarkdownSkeleton />;
  }

  if (error !== null) {
    return (
      <Empty className="min-h-[360px] justify-center">
        <EmptyHeader>
          <EmptyTitle>Could not load page</EmptyTitle>
          <EmptyDescription>{error}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  if (page === null) {
    return <MarkdownSkeleton />;
  }

  return (
    <Message from="assistant" className="block">
      <MessageContent className="max-w-none rounded-xl border border-hairline bg-surface px-5 py-5 shadow-sm md:px-7 md:py-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-hairline pb-3">
          <div className="min-w-0">
            <p className="label-eyebrow text-fg-mute">{page.path}</p>
            <p className="mt-1 text-sm text-fg-dim">{page.chars.toLocaleString()} chars</p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void navigator.clipboard.writeText(page.path)}
          >
            Copy path
          </Button>
        </div>
        <MessageResponse className="wiki-markdown">
          {normalizeWikiMarkdown(page.content)}
        </MessageResponse>
      </MessageContent>
    </Message>
  );
}

function WikiTreeSkeleton(): React.ReactElement {
  return (
    <div className="flex flex-col gap-2 px-2 py-1">
      {Array.from({ length: 12 }).map((_, index) => (
        <Skeleton
          key={index}
          className={cn("h-5 rounded-md", index % 3 === 0 ? "w-3/4" : "w-11/12")}
        />
      ))}
    </div>
  );
}

function MarkdownSkeleton(): React.ReactElement {
  return (
    <div className="flex flex-col gap-3">
      <Skeleton className="h-7 w-2/3" />
      <Skeleton className="h-4 w-1/2" />
      <div className="flex flex-col gap-2 pt-4">
        {Array.from({ length: 9 }).map((_, index) => (
          <Skeleton key={index} className={cn("h-4", index % 4 === 0 ? "w-5/6" : "w-full")} />
        ))}
      </div>
    </div>
  );
}

function defaultOpenPaths(entries: WikiTreeEntry[]): Set<string> {
  const defaults = new Set<string>();
  for (const entry of entries) {
    if (
      entry.type === "directory" &&
      ["actions", "decisions", "meetings", "people", "projects", "threads"].includes(entry.path)
    ) {
      defaults.add(entry.path);
    }
  }
  return defaults;
}

function normalizeWikiMarkdown(content: string): string {
  return convertWikiLinks(stripFrontmatter(content));
}

function stripFrontmatter(content: string): string {
  if (!content.startsWith("---\n")) {
    return content;
  }
  const end = content.indexOf("\n---", 4);
  if (end === -1) {
    return content;
  }
  const after = content.indexOf("\n", end + 4);
  return after === -1 ? "" : content.slice(after + 1).trimStart();
}

function convertWikiLinks(content: string): string {
  return content.replace(
    /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,
    (_match, target: string, label?: string) => {
      const text = label ?? target.split("/").at(-1) ?? target;
      return text.trim();
    },
  );
}
