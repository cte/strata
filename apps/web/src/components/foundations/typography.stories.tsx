import type { Meta, StoryObj } from "@storybook/react-vite";
import { useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

// A type specimen for verifying the font + size scale. Each row measures and
// shows its own *computed* font-size, so the rendered px (after the 106% root
// scale) is visible — e.g. text-2xs = 0.8125rem renders at ~13.8px.
const meta = {
  title: "Foundations/Typography",
  parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// Full literal class names so Tailwind generates them.
const SIZES = [
  { token: "text-2xs", rem: "0.8125rem", cls: "text-2xs" },
  { token: "text-xs", rem: "0.875rem", cls: "text-xs" },
  { token: "text-sm", rem: "0.9375rem", cls: "text-sm" },
  { token: "text-base", rem: "1rem", cls: "text-base" },
  { token: "text-md", rem: "1.0625rem", cls: "text-md" },
  { token: "text-lg", rem: "1.125rem", cls: "text-lg" },
  { token: "text-xl", rem: "1.25rem", cls: "text-xl" },
  { token: "text-2xl", rem: "1.5rem", cls: "text-2xl" },
];

function useComputedFontSize(): [React.RefObject<HTMLSpanElement | null>, string] {
  const ref = useRef<HTMLSpanElement | null>(null);
  const [px, setPx] = useState("…");
  useLayoutEffect(() => {
    if (ref.current) {
      const fs = Number.parseFloat(getComputedStyle(ref.current).fontSize);
      setPx(`${fs.toFixed(1)}px`);
    }
  }, []);
  return [ref, px];
}

function SizeRow({
  token,
  rem,
  cls,
}: {
  token: string;
  rem: string;
  cls: string;
}): React.ReactElement {
  const [ref, px] = useComputedFontSize();
  return (
    <div className="flex items-baseline gap-6 border-b border-hairline py-4">
      <code className="w-28 shrink-0 font-mono text-2xs text-fg-mute">{token}</code>
      <code className="w-32 shrink-0 font-mono text-2xs text-fg-mute">
        {rem} → {px}
      </code>
      <span ref={ref} className={cn("min-w-0 truncate text-fg", cls)}>
        The quick brown fox jumps over the lazy dog
      </span>
    </div>
  );
}

/** Named font-size tokens, each showing its computed px after the 106% root scale. */
export const TypeScale: Story = {
  render: () => (
    <div className="min-h-dvh bg-bg p-10 text-fg">
      <p className="label-eyebrow mb-1">Foundations</p>
      <h1 className="text-2xl font-medium tracking-tight">Type scale</h1>
      <p className="mb-8 mt-2 max-w-xl text-sm leading-6 text-fg-dim">
        Always size text with these named tokens (never{" "}
        <code className="font-mono">text-[13px]</code>
        ). The root font-size is 100%, so rendered px = rem × 16.
      </p>
      <div className="max-w-3xl">
        {SIZES.map((s) => (
          <SizeRow key={s.token} {...s} />
        ))}
      </div>
    </div>
  ),
};

/** The two families and their weights, plus the shared eyebrow/label style. */
export const Fonts: Story = {
  render: () => (
    <div className="min-h-dvh space-y-10 bg-bg p-10 text-fg">
      <section>
        <p className="label-eyebrow mb-2">Sans — Geist (--font-sans, default body)</p>
        <p className="text-lg">The quick brown fox jumps over the lazy dog. 0123456789</p>
        <div className="mt-3 flex flex-wrap gap-6 text-base">
          <span className="font-normal">Regular 400</span>
          <span className="font-medium">Medium 500</span>
          <span className="font-semibold">Semibold 600</span>
        </div>
      </section>

      <section>
        <p className="label-eyebrow mb-2">Mono — Geist Mono (.font-mono)</p>
        <p className="font-mono text-lg">The quick brown fox jumps over the lazy dog. 0123456789</p>
        <div className="mt-3 flex flex-wrap gap-6 font-mono text-base">
          <span className="font-normal">Regular 400</span>
          <span className="font-medium">Medium 500</span>
          <span className="font-semibold">Semibold 600</span>
        </div>
      </section>

      <section>
        <p className="label-eyebrow mb-2">Eyebrow / label (.label-eyebrow)</p>
        <p className="label-eyebrow">Section label · uppercase mono</p>
      </section>
    </div>
  ),
};
