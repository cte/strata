import type * as React from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * Shared presentational primitives for TanStack Form fields. Field state comes
 * from the form; these just render label/hint/error and a styled select.
 */

export interface FieldMetaLike {
  isTouched: boolean;
  errors: unknown[];
}

/** First user-facing message for a touched field, or null. */
export function fieldError(meta: FieldMetaLike): string | null {
  if (!meta.isTouched) {
    return null;
  }
  for (const error of meta.errors) {
    if (error == null) {
      continue;
    }
    if (typeof error === "string") {
      return error;
    }
    if (typeof error === "object" && "message" in error) {
      return String((error as { message: unknown }).message);
    }
    return String(error);
  }
  return null;
}

export function hasError(meta: FieldMetaLike): boolean {
  return fieldError(meta) !== null;
}

export function FormField({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string | undefined;
  error?: string | null;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <label className="block space-y-1.5">
      <span className="flex items-center justify-between gap-2">
        <span className="label-eyebrow text-[var(--fg-mute)]">{label}</span>
        {hint ? <span className="font-mono text-[10px] text-[var(--fg-mute)]">{hint}</span> : null}
      </span>
      {children}
      {error ? <p className="font-mono text-2xs text-[var(--bad)]">{error}</p> : null}
    </label>
  );
}

export function SelectInput({
  value,
  options,
  disabled = false,
  onChange,
}: {
  value: string;
  options: readonly { value: string; label: string }[] | readonly string[];
  disabled?: boolean;
  onChange(value: string): void;
}): React.ReactElement {
  const normalized = options.map((option) =>
    typeof option === "string" ? { value: option, label: option } : option,
  );
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger className="h-9 w-full border-[var(--hairline)] bg-[var(--bg)] text-xs text-[var(--fg)]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {normalized.map((option) => (
          <SelectItem key={option.value} value={option.value} className="text-xs">
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
