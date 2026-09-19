"use client";

/**
 * The small pieces. Chrome is neutral by design: the accent is the ink itself,
 * so no button, border or focus ring can be mistaken for one of the six category
 * colours. Colour in this product means category and nothing else.
 */

import { useEffect, useRef, useState } from "react";
import { CATEGORY_HINT, categoryVar, labelFor } from "@/lib/categories";

export function ErrorText({ code, message }: { code?: string; message: string }) {
  return (
    <p
      role="alert"
      className="rounded-lg border border-danger/35 bg-danger-soft px-3 py-2 text-sm text-danger"
    >
      {message}
      {code ? <span className="ml-2 font-mono text-xs opacity-70">{code}</span> : null}
    </p>
  );
}

type ButtonVariant = "primary" | "ghost" | "quiet" | "danger";

export function Button({
  children,
  variant = "primary",
  className = "",
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  const base =
    "inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45";
  const look: Record<ButtonVariant, string> = {
    primary: "bg-accent text-accent-ink hover:opacity-88",
    ghost: "border border-line bg-surface text-ink hover:bg-surface-2",
    quiet: "text-ink-2 hover:bg-surface-2 hover:text-ink",
    danger: "border border-danger/40 bg-danger-soft text-danger hover:border-danger/70",
  };
  return (
    <button className={`${base} ${look[variant]} ${className}`} {...rest}>
      {children}
    </button>
  );
}

export const inputClass =
  "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-3 outline-none transition-colors focus:border-line-2";

/** A category as a dot plus its name. The dot carries the colour, the text carries
 *  the meaning. Two of the six hues sit below 3:1 on the light surface, so the
 *  label is not optional. */
export function CategoryChip({
  category,
  count,
  active,
  onClick,
  title,
}: {
  category: string;
  count?: number;
  active?: boolean;
  onClick?: () => void;
  title?: string;
}) {
  const inner = (
    <>
      <span
        aria-hidden
        className="size-2 shrink-0 rounded-full"
        style={{ background: categoryVar(category as never) }}
      />
      <span>{labelFor(category)}</span>
      {count === undefined ? null : <span className="tnum text-ink-3">{count}</span>}
    </>
  );

  const shell =
    "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors";

  if (!onClick) {
    return (
      <span className={`${shell} border-line bg-surface text-ink-2`} title={title}>
        {inner}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={Boolean(active)}
      title={title ?? CATEGORY_HINT[category as never]}
      className={`${shell} ${
        active ? "border-line-2 bg-surface-3 text-ink" : "border-line bg-surface text-ink-2 hover:bg-surface-2"
      }`}
    >
      {inner}
    </button>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-surface-2 ${className}`} aria-hidden />;
}

/** Copy with confirmation, falling back to manual selection when clipboard is blocked. */
export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [state, setState] = useState<"idle" | "done" | "fail">("idle");
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setState("done");
    } catch {
      setState("fail");
    }
    setTimeout(() => setState("idle"), 1800);
  }
  return (
    <Button variant="ghost" type="button" onClick={copy}>
      {state === "done" ? "Copied" : state === "fail" ? "Select and copy manually" : label}
    </Button>
  );
}

/**
 * Two-step delete. Deleting cannot be undone and there is no history, so it never
 * happens on one click. The second click is a different word in a different
 * place, not a repeat of the first.
 */
export function ConfirmButton({
  onConfirm,
  idleLabel = "Delete",
  confirmLabel = "Really delete",
  busy,
}: {
  onConfirm: () => void;
  idleLabel?: string;
  confirmLabel?: string;
  busy?: boolean;
}) {
  const [armed, setArmed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  if (!armed) {
    return (
      <Button
        variant="quiet"
        type="button"
        disabled={busy}
        onClick={() => {
          setArmed(true);
          timer.current = setTimeout(() => setArmed(false), 5000);
        }}
      >
        {idleLabel}
      </Button>
    );
  }

  return (
    <span className="inline-flex items-center gap-1">
      <Button variant="danger" type="button" disabled={busy} onClick={onConfirm}>
        {busy ? "Deleting…" : confirmLabel}
      </Button>
      <Button variant="quiet" type="button" onClick={() => setArmed(false)}>
        Keep
      </Button>
    </span>
  );
}

/** Character counter that turns into the error before the server has to say it. */
export function CharCount({ value, max }: { value: string; max: number }) {
  const length = value.trim().length;
  const over = length > max;
  return (
    <span className={`tnum text-xs ${over ? "text-danger" : "text-ink-3"}`}>
      {length}/{max}
    </span>
  );
}
