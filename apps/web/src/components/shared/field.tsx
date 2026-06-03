import type * as React from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Lightweight labeled-field primitives for plain controlled inputs (not bound
 * to TanStack Form — for that use `FormField` from `components/form`). `Field`
 * renders an eyebrow label, an optional hint, and an arbitrary control; `Field`
 * + `TextField` replace the ad-hoc `label > span > Input` blocks and the
 * per-route `LabeledInput` helpers so every plain field reads the same.
 */
export function Field({
  label,
  hint,
  htmlFor,
  className,
  children,
}: {
  label: React.ReactNode;
  hint?: React.ReactNode;
  htmlFor?: string;
  className?: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <label htmlFor={htmlFor} className={cn("grid gap-1.5", className)}>
      <span className="flex items-center justify-between gap-2">
        <span className="label-eyebrow text-fg-mute">{label}</span>
        {hint ? <span className="font-mono text-2xs text-fg-mute">{hint}</span> : null}
      </span>
      {children}
    </label>
  );
}

export interface TextFieldProps extends Omit<React.ComponentProps<typeof Input>, "onChange"> {
  label: React.ReactNode;
  hint?: React.ReactNode;
  onChange(value: string): void;
  /** Render the input value in the mono face (useful for URLs, slugs, keys). */
  mono?: boolean;
}

export function TextField({
  label,
  hint,
  onChange,
  mono = false,
  className,
  ...inputProps
}: TextFieldProps): React.ReactElement {
  return (
    <Field label={label} hint={hint}>
      <Input
        className={cn(mono && "font-mono text-xs", className)}
        onChange={(event) => onChange(event.currentTarget.value)}
        {...inputProps}
      />
    </Field>
  );
}
