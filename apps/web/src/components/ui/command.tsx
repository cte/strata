import { Combobox as ComboboxPrimitive } from "@base-ui/react/combobox";
import { Search } from "lucide-react";
import type * as React from "react";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/**
 * Command palette built on Base UI's `Combobox`.
 *
 * Unlike the previous cmdk implementation, Base UI's combobox is data-driven:
 * the `Command` root receives an `items` array (flat or grouped) and filters it
 * automatically, while `CommandList` renders the filtered results through a
 * render-function child. The picker stays inline and always-open (it lives
 * inside a dialog), so there is no positioner/popup — `CommandList` renders the
 * list directly.
 */

type CommandProps<ItemValue> = Omit<
  React.ComponentProps<typeof ComboboxPrimitive.Root<ItemValue>>,
  "render"
> & {
  className?: string;
};

function Command<ItemValue>({
  className,
  children,
  ...props
}: CommandProps<ItemValue>): React.ReactElement {
  return (
    <ComboboxPrimitive.Root
      // Inline, always-open list inside the dialog.
      open
      openOnInputClick={false}
      {...props}
    >
      <div className={cn("flex h-full w-full flex-col overflow-hidden text-fg", className)}>
        {children}
      </div>
    </ComboboxPrimitive.Root>
  );
}

function CommandInput({
  className,
  ...props
}: React.ComponentProps<typeof ComboboxPrimitive.Input>): React.ReactElement {
  return (
    <div className="flex items-center border-b px-3" data-slot="command-input-wrapper">
      <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
      <ComboboxPrimitive.Input
        className={cn(
          "flex h-11 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-fg-mute disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        {...props}
      />
    </div>
  );
}

type CommandListProps<ItemValue> = Omit<
  React.ComponentProps<typeof ComboboxPrimitive.List>,
  "children"
> & {
  // Data-driven (render function over filtered items) OR children-driven
  // (plain nodes, with filtering handled externally via `filter={null}`).
  children: ((item: ItemValue, index: number) => React.ReactNode) | React.ReactNode;
};

function CommandList<ItemValue>({
  className,
  children,
  ...props
}: CommandListProps<ItemValue>): React.ReactElement {
  return (
    <ComboboxPrimitive.List
      className={cn(
        "themed-scrollbar max-h-[300px] overflow-y-auto overflow-x-hidden [scrollbar-gutter:stable_both-edges]",
        className,
      )}
      {...props}
    >
      {children as React.ReactNode}
    </ComboboxPrimitive.List>
  );
}

function CommandEmpty({
  className,
  ...props
}: React.ComponentProps<typeof ComboboxPrimitive.Empty>): React.ReactElement {
  return (
    <ComboboxPrimitive.Empty
      className={cn("py-6 text-center text-sm text-fg-mute", className)}
      {...props}
    />
  );
}

function CommandGroup({
  className,
  ...props
}: React.ComponentProps<typeof ComboboxPrimitive.Group>): React.ReactElement {
  return <ComboboxPrimitive.Group className={cn("overflow-hidden p-1", className)} {...props} />;
}

function CommandCollection<ItemValue>(props: {
  children: (item: ItemValue, index: number) => React.ReactNode;
}): React.ReactElement {
  return (
    <ComboboxPrimitive.Collection>
      {props.children as (item: unknown, index: number) => React.ReactNode}
    </ComboboxPrimitive.Collection>
  );
}

function CommandGroupLabel({
  className,
  ...props
}: React.ComponentProps<typeof ComboboxPrimitive.GroupLabel>): React.ReactElement {
  return (
    <ComboboxPrimitive.GroupLabel
      className={cn("px-2 py-1.5 text-2xs font-medium text-fg-mute", className)}
      {...props}
    />
  );
}

type CommandItemProps = React.ComponentProps<typeof ComboboxPrimitive.Item> & {
  // cmdk-style alias: fired when the item is chosen. Base UI uses onClick.
  onSelect?: () => void;
};

function CommandItem({
  className,
  onSelect,
  onClick,
  ...props
}: CommandItemProps): React.ReactElement {
  return (
    <ComboboxPrimitive.Item
      onClick={(event) => {
        onClick?.(event);
        onSelect?.();
      }}
      className={cn(
        "relative flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none data-disabled:pointer-events-none data-highlighted:bg-accent-soft data-highlighted:text-fg data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-3.5 [&_svg]:shrink-0",
        className,
      )}
      {...props}
    />
  );
}

function CommandItemIndicator(
  props: React.ComponentProps<typeof ComboboxPrimitive.ItemIndicator>,
): React.ReactElement {
  return <ComboboxPrimitive.ItemIndicator {...props} />;
}

function CommandSeparator({
  className,
  ...props
}: React.ComponentProps<typeof ComboboxPrimitive.Separator>): React.ReactElement {
  return (
    <ComboboxPrimitive.Separator className={cn("-mx-1 h-px bg-hairline", className)} {...props} />
  );
}

const CommandShortcut = ({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) => {
  return (
    <span className={cn("ml-auto text-xs tracking-widest text-fg-mute", className)} {...props} />
  );
};
CommandShortcut.displayName = "CommandShortcut";

type CommandDialogProps<ItemValue> = React.ComponentProps<typeof Dialog> & {
  title?: React.ReactNode;
  commandProps?: Omit<CommandProps<ItemValue>, "children">;
  children?: React.ReactNode;
};

function CommandDialog<ItemValue>({
  children,
  commandProps,
  title = "Command menu",
  ...props
}: CommandDialogProps<ItemValue>): React.ReactElement {
  return (
    <Dialog {...props}>
      <DialogContent className="overflow-hidden p-0! sm:p-0! [&>button]:hidden">
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <Command {...commandProps}>{children}</Command>
      </DialogContent>
    </Dialog>
  );
}

export {
  Command,
  CommandCollection,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandGroupLabel,
  CommandInput,
  CommandItem,
  CommandItemIndicator,
  CommandList,
  CommandSeparator,
  CommandShortcut,
};
