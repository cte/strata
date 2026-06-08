import type { ComponentProps, ReactNode } from "react";
import {
  Command,
  CommandCollection,
  CommandEmpty,
  CommandGroup,
  CommandGroupLabel,
  CommandInput,
  CommandItem,
  CommandItemIndicator,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export type ModelSelectorProps = ComponentProps<typeof Dialog>;

export const ModelSelector = (props: ModelSelectorProps) => <Dialog {...props} />;

export type ModelSelectorTriggerProps = ComponentProps<typeof DialogTrigger>;

export const ModelSelectorTrigger = (props: ModelSelectorTriggerProps) => (
  <DialogTrigger {...props} />
);

export type ModelSelectorContentProps = ComponentProps<typeof DialogContent> & {
  title?: ReactNode;
};

export const ModelSelectorContent = ({
  className,
  children,
  title = "Model Selector",
  ...props
}: ModelSelectorContentProps) => (
  <DialogContent
    aria-describedby={undefined}
    className={cn(
      "overflow-hidden border-none! p-0! outline! outline-hairline! outline-solid! sm:p-0!",
      className,
    )}
    {...props}
  >
    <DialogTitle className="sr-only">{title}</DialogTitle>
    {children}
  </DialogContent>
);

export const ModelSelectorCommand = Command;
export const ModelSelectorInput = ({
  className,
  ...props
}: ComponentProps<typeof CommandInput>) => <CommandInput className={cn(className)} {...props} />;
export const ModelSelectorList = CommandList;
export const ModelSelectorCollection = CommandCollection;
export const ModelSelectorEmpty = CommandEmpty;
export const ModelSelectorGroup = CommandGroup;
export const ModelSelectorGroupLabel = CommandGroupLabel;
export const ModelSelectorItem = CommandItem;
export const ModelSelectorItemIndicator = CommandItemIndicator;
export const ModelSelectorSeparator = CommandSeparator;
export const ModelSelectorShortcut = CommandShortcut;

export type ModelSelectorNameProps = ComponentProps<"span">;

export const ModelSelectorName = ({ className, ...props }: ModelSelectorNameProps) => (
  <span className={cn("flex-1 truncate text-left", className)} {...props} />
);
