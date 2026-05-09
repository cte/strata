import { Tabs as BaseTabs } from "@base-ui/react/tabs";
import type * as React from "react";
import { cn } from "@/lib/utils";

export const TabsRoot = BaseTabs.Root;

export function TabsList({
  className,
  ...props
}: React.ComponentProps<typeof BaseTabs.List>): React.ReactElement {
  return (
    <BaseTabs.List
      className={cn(
        "relative inline-flex items-end gap-6 border-b border-[var(--hairline)]",
        className,
      )}
      {...props}
    />
  );
}

export function TabsTab({
  className,
  ...props
}: React.ComponentProps<typeof BaseTabs.Tab>): React.ReactElement {
  return (
    <BaseTabs.Tab
      className={cn(
        "label-eyebrow relative cursor-pointer select-none px-0.5 py-3 text-[var(--fg-mute)] transition-colors duration-150 hover:text-[var(--fg-dim)] data-[selected]:text-[var(--fg)]",
        className,
      )}
      {...props}
    />
  );
}

export function TabsIndicator({
  className,
  ...props
}: React.ComponentProps<typeof BaseTabs.Indicator>): React.ReactElement {
  return (
    <BaseTabs.Indicator
      className={cn(
        "absolute bottom-[-1px] h-[1px] bg-[var(--accent)] transition-all duration-200 ease-out",
        className,
      )}
      style={{
        left: "var(--active-tab-left)",
        width: "var(--active-tab-width)",
      }}
      {...props}
    />
  );
}

export function TabsPanel({
  className,
  ...props
}: React.ComponentProps<typeof BaseTabs.Panel>): React.ReactElement {
  return <BaseTabs.Panel className={cn("mt-7 outline-none", className)} {...props} />;
}
