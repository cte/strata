import { Paperclip, Send, Square } from "lucide-react";
import type * as React from "react";
import { useCallback, useRef } from "react";
import {
  Attachment,
  type AttachmentData,
  AttachmentPreview,
  AttachmentRemove,
  Attachments,
} from "@/components/ai-elements/attachments";
import { AutocompletePopover } from "@/components/autocomplete-popover";
import { Button } from "@/components/ui/button";
import type { AutocompleteItem, AutocompleteProvider } from "@/lib/useAutocomplete";
import { useAutocomplete } from "@/lib/useAutocomplete";
import { cn } from "@/lib/utils";

export interface PromptInputProps extends Omit<React.ComponentProps<"form">, "onSubmit"> {
  value: string;
  running?: boolean;
  disabled?: boolean;
  attachments?: AttachmentData[];
  onValueChange(value: string): void;
  onSubmit(): void;
  onCancel?(): void;
  onAddFiles?(files: FileList): void;
  onRemoveAttachment?(id: string): void;
  acceptedFileTypes?: string;
  autocompleteProviders?: readonly AutocompleteProvider[];
  toolbar?: React.ReactNode;
  onAutocompleteCommit?(item: AutocompleteItem, value: string): void;
  onUnhandledKeyDown?(event: React.KeyboardEvent<HTMLTextAreaElement>): boolean;
}

export function PromptInput({
  value,
  running = false,
  disabled = false,
  attachments,
  onValueChange,
  onSubmit,
  onCancel,
  onAddFiles,
  onRemoveAttachment,
  acceptedFileTypes = "image/*",
  autocompleteProviders = [],
  toolbar,
  onAutocompleteCommit,
  onUnhandledKeyDown,
  className,
  ...props
}: PromptInputProps): React.ReactElement {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const hasAttachments = attachments !== undefined && attachments.length > 0;
  const canSubmit = !running && (value.trim() !== "" || hasAttachments);
  const attachEnabled = onAddFiles !== undefined;
  const autocomplete = useAutocomplete(textareaRef, {
    value,
    providers: autocompleteProviders,
    onValueChange,
    disabled,
    ...(onAutocompleteCommit === undefined ? {} : { onCommit: onAutocompleteCommit }),
  });

  const handleAttachClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = event.target.files;
      if (files !== null && files.length > 0) {
        onAddFiles?.(files);
      }
      event.target.value = "";
    },
    [onAddFiles],
  );

  return (
    <form
      className={cn("border-t border-[var(--hairline)] bg-[var(--bg-elev)] p-3", className)}
      onSubmit={(event) => {
        event.preventDefault();
        if (running) {
          onCancel?.();
          return;
        }
        onSubmit();
      }}
      {...props}
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-2">
        <AutocompletePopover
          open={autocomplete.open}
          items={autocomplete.items}
          selectedIndex={autocomplete.selectedIndex}
          anchorRect={autocomplete.anchorRect}
          onAccept={autocomplete.accept}
          onSelect={autocomplete.select}
        />
        {toolbar === undefined ? null : (
          <div className="flex min-h-7 min-w-0 items-center justify-between gap-2">{toolbar}</div>
        )}
        {hasAttachments ? (
          <Attachments variant="grid" className="ml-0 self-start">
            {attachments.map((attachment) => (
              <Attachment
                key={attachment.id}
                data={attachment}
                {...(onRemoveAttachment === undefined
                  ? {}
                  : { onRemove: () => onRemoveAttachment(attachment.id) })}
              >
                <AttachmentPreview />
                <AttachmentRemove />
              </Attachment>
            ))}
          </Attachments>
        ) : null}
        <div className="flex items-end gap-2">
          {attachEnabled ? (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept={acceptedFileTypes}
                multiple
                hidden
                onChange={handleFileChange}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={disabled || running}
                onClick={handleAttachClick}
                aria-label="Attach image"
                title="Attach image"
                className="h-10 w-10 shrink-0"
              >
                <Paperclip size={14} strokeWidth={1.75} />
              </Button>
            </>
          ) : null}
          <textarea
            ref={textareaRef}
            value={value}
            disabled={disabled}
            onChange={(event) => onValueChange(event.target.value)}
            onFocus={autocomplete.refresh}
            onKeyDown={(event) => {
              if (autocomplete.onKeyDown(event)) {
                return;
              }
              if (onUnhandledKeyDown?.(event)) {
                return;
              }
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                if (running) return;
                onSubmit();
              }
            }}
            rows={1}
            placeholder="Ask Strata"
            className="max-h-40 min-h-10 flex-1 resize-none rounded-md border border-[var(--hairline)] bg-[var(--bg)] px-3 py-2.5 text-[13px] leading-5 text-[var(--fg)] outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-[var(--fg-mute)] focus:border-[var(--accent)] focus:shadow-[0_0_0_3px_var(--accent-soft)] disabled:opacity-50"
          />
          <Button
            type="submit"
            size="icon"
            variant={running ? "secondary" : "default"}
            disabled={disabled || (!running && !canSubmit)}
            aria-label={running ? "Stop run" : "Send message"}
            title={running ? "Stop run" : "Send message"}
            className="h-10 w-10 shrink-0"
          >
            {running ? <Square size={14} strokeWidth={2} /> : <Send size={14} strokeWidth={2} />}
          </Button>
        </div>
      </div>
    </form>
  );
}
