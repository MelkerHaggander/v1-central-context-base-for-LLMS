"use client";

/**
 * The small pieces. Chrome is neutral by design: the accent is the ink itself,
 * so no button, border or focus ring can be mistaken for one of the six category
 * colours. Colour in this product means category and nothing else.
 */

import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { CATEGORY_HINT, categoryVar, labelFor } from "@/lib/categories";
import { displayErrorMessage } from "@/lib/display-error";
import { LEAVE_MS } from "@/lib/motion";
import { CloseIcon } from "./icons";
import { motionReduced, usePresence } from "./useMotion";

export function ErrorText({ code, message }: { code?: string; message: string }) {
  return (
    <p
      role="alert"
      className="rise rounded-lg border border-danger/35 bg-danger-soft px-3 py-2 text-sm text-danger"
    >
      {displayErrorMessage(code, message)}
      {code ? <span className="ml-2 font-mono text-xs opacity-70">{code}</span> : null}
    </p>
  );
}

type ButtonVariant = "primary" | "ghost" | "quiet" | "danger";

/** A small turning ring for a button that is working. Decorative: the label says "Saving…". */
export function Spinner({ className = "" }: { className?: string }) {
  return <span aria-hidden className={`spinner shrink-0 ${className}`} />;
}

/**
 * Every button sinks a little when pressed (.press). `busy` adds the spinner
 * in front of the label and keeps the width from jumping as the text changes.
 */
export function Button({
  children,
  variant = "primary",
  className = "",
  busy = false,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; busy?: boolean }) {
  const base =
    "press inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-45";
  const look: Record<ButtonVariant, string> = {
    primary: "bg-accent text-accent-ink hover:opacity-88",
    ghost: "border border-line bg-surface text-ink hover:bg-surface-2",
    quiet: "text-ink-2 hover:bg-surface-2 hover:text-ink",
    danger: "border border-danger/40 bg-danger-soft text-danger hover:border-danger/70",
  };
  return (
    <button className={`${base} ${look[variant]} ${className}`} aria-busy={busy || undefined} {...rest}>
      {busy ? <Spinner /> : null}
      {children}
    </button>
  );
}

export const inputClass =
  "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-3 outline-none transition-colors focus:border-line-2";

/** A category as a dot plus its name. The dot carries the colour, the text carries
 *  the meaning. Two of the six hues sit below 3:1 on the light surface, so the
 *  label is not optional.
 *
 *  v1.2: no pill. Alfredo's point 2 asked for the rounded badge around the text
 *  to go, so this is plain text with a dot, and the active one gets a quiet
 *  underline instead of a filled capsule. */
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
      <span className="u-line" data-on={Boolean(active)}>
        {labelFor(category)}
      </span>
      {count === undefined ? null : (
        <span className="text-ink-3">
          <CountUp value={count} />
        </span>
      )}
    </>
  );

  const shell = "press inline-flex shrink-0 items-center gap-1.5 px-1.5 py-1 text-xs";

  if (!onClick) {
    return (
      <span className={`${shell} text-ink-2`} title={title}>
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
      className={`${shell} rounded-md ${active ? "font-medium text-ink" : "text-ink-2 hover:text-ink"}`}
    >
      {inner}
    </button>
  );
}

/**
 * True inside a panel that is closing. GlobeView keeps the last panel mounted
 * for the length of the slide out and says so through this.
 */
export const LeavingContext = createContext(false);

/**
 * The side panel. From sm up it sits beside the globe, 17.5 rem wide (19 on
 * wide screens), a third narrower than v1.1's 26 rem (Alfredo's point 4).
 * On a phone it is a bottom sheet over the globe, so the sphere is still there behind it (Melker's point 6).
 */
export function PanelShell({
  label,
  title,
  subtitle,
  actions,
  onClose,
  children,
  footer,
}: {
  label: string;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const leaving = useContext(LeavingContext);
  return (
    <aside
      aria-label={label}
      // Closing: out of reach for clicks, focus and screen readers while it slides away.
      inert={leaving || undefined}
      className={`${leaving ? "slide-out" : "slide-in"} fixed inset-x-0 bottom-0 z-30 flex h-[72dvh] flex-col overflow-hidden rounded-t-2xl border-t border-line bg-surface shadow-2xl sm:static sm:z-auto sm:h-full sm:w-[17.5rem] sm:rounded-none sm:border-l sm:border-t-0 sm:shadow-none xl:w-[19rem]`}
    >
      <div aria-hidden className="mx-auto mt-2 h-1 w-10 rounded-full bg-line-2 sm:hidden" />
      {/* Title on its own line, actions under it. In a 17.5 rem panel a title
          and three buttons on one row left "Me..." of the title. */}
      <header className="px-4 pb-2 pt-4">
        <div className="flex items-start gap-2">
          <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close panel"
            className="press -mr-1 -mt-0.5 grid size-7 shrink-0 place-items-center rounded-md text-ink-2 hover:bg-surface-2 hover:text-ink"
          >
            <CloseIcon className="size-4" />
          </button>
        </div>
        {subtitle ? <p className="tnum mt-0.5 text-xs text-ink-3">{subtitle}</p> : null}
        {actions ? <div className="-ml-2 mt-1.5 flex flex-wrap items-center gap-0.5">{actions}</div> : null}
      </header>
      <div className="thin-scroll min-h-0 flex-1 overflow-y-auto">{children}</div>
      {footer ? <div className="rise border-t border-line px-4 py-3">{footer}</div> : null}
    </aside>
  );
}

/** Small uppercase-free tag, used for "New" and "Changed". Text, not colour. */
export function Tag({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className="pop-in shrink-0 rounded border border-line-2 px-1 py-px text-[10px] font-medium leading-none text-ink-2"
    >
      {children}
    </span>
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
      {/* Keyed, so each new label fades in instead of the text jumping. */}
      <span key={state} className="fade-in inline-flex items-center gap-1.5">
        {state === "done" ? <CheckIcon /> : null}
        {state === "done" ? "Copied" : state === "fail" ? "Select and copy manually" : label}
      </span>
    </Button>
  );
}

/**
 * Two-step delete. The server has no undo, so it never happens on one click.
 * The second click is a different word in a different place, not a repeat of
 * the first. After it the delete still waits a few seconds with an Undo
 * (lib/delete-queue.ts) before anything is sent.
 */
export function ConfirmButton({
  onConfirm,
  idleLabel = "Delete",
  confirmLabel = "Really delete",
  busyLabel = "Deleting…",
  busy,
}: {
  onConfirm: () => void;
  idleLabel?: string;
  confirmLabel?: string;
  busyLabel?: string;
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
    <span className="pop-in inline-flex items-center gap-1">
      <Button variant="danger" type="button" disabled={busy} onClick={onConfirm}>
        {busy ? busyLabel : confirmLabel}
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
    <span className={`tnum text-xs transition-colors ${over ? "text-danger" : "text-ink-3"}`}>
      {length}/{max}
    </span>
  );
}

/** The check drawn in CopyButton's "Copied". Local so ui.tsx stays free of icon churn. */
function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden className="pop-in size-3.5">
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

/**
 * One row of a list. It rises in (a few at a time when a list opens: `index`)
 * and closes in height when `leaving`. The li has one child so the height can
 * move; pass the li's own look (borders) in `className`, the padding in
 * `innerClassName`.
 */
export function Row({
  leaving = false,
  index = 0,
  className = "",
  innerClassName = "",
  onHover,
  children,
}: {
  leaving?: boolean;
  index?: number;
  className?: string;
  innerClassName?: string;
  /** Pointer or focus on the row: its vertical middle on screen, or null when it leaves. */
  onHover?: (y: number | null) => void;
  children: React.ReactNode;
}) {
  const at = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    return r.top + r.height / 2;
  };
  return (
    <li
      inert={leaving || undefined}
      className={`bc-row ${leaving ? "bc-row-out" : "bc-row-in"} ${className}`}
      style={{ "--i": index } as React.CSSProperties}
    >
      <div
        className={innerClassName}
        onMouseEnter={onHover ? (e) => onHover(at(e.currentTarget)) : undefined}
        onMouseMove={onHover ? (e) => onHover(at(e.currentTarget)) : undefined}
        onMouseLeave={onHover ? () => onHover(null) : undefined}
        onFocus={onHover ? (e) => onHover(at(e.currentTarget)) : undefined}
        onBlur={onHover ? () => onHover(null) : undefined}
      >
        {children}
      </div>
    </li>
  );
}

/** Opens and closes in height. Stays mounted while it closes. */
export function Collapsible({
  open,
  className = "",
  children,
}: {
  open: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const { mounted, leaving } = usePresence(open, LEAVE_MS.row);
  if (!mounted) return null;
  return (
    <div className={leaving ? "bc-collapse" : "bc-expand"} inert={leaving || undefined}>
      <div className={className}>{children}</div>
    </div>
  );
}

/**
 * The sliding thumb of a segmented control. Put `box` on the row, give the
 * picked option data-active="true", and render <span ref={thumb} className=
 * "seg-thumb ..." /> inside the row. The thumb is placed under the picked
 * option by measuring it, so options of any width work, and slides when the
 * pick changes. It appears in place the first time instead of sliding in.
 *
 * `remember` names a control that is rebuilt when its pick changes (the
 * space switch lives inside the globe, which starts over for every space):
 * the thumb then starts where it last was and still slides.
 */
const lastThumb = new Map<string, { width: string; transform: string }>();

export function useSegmentThumb(active: string, remember?: string) {
  const box = useRef<HTMLDivElement | null>(null);
  const thumb = useRef<HTMLSpanElement | null>(null);

  useLayoutEffect(() => {
    const row = box.current;
    const bar = thumb.current;
    if (!row || !bar) return;
    const before = remember ? lastThumb.get(remember) : undefined;
    if (before && bar.dataset.ready !== "true") {
      bar.style.width = before.width;
      bar.style.transform = before.transform;
      bar.style.opacity = "1";
      void bar.getBoundingClientRect(); // commit the old place before the transition is switched on
      bar.dataset.ready = "true";
    }
    const place = () => {
      const picked = row.querySelector<HTMLElement>('[data-active="true"]');
      if (!picked) {
        bar.style.opacity = "0";
        return;
      }
      bar.style.width = `${picked.offsetWidth}px`;
      bar.style.transform = `translateX(${picked.offsetLeft}px)`;
      bar.style.opacity = "1";
      if (remember) lastThumb.set(remember, { width: bar.style.width, transform: bar.style.transform });
    };
    place();
    // Only after the first placement may it slide.
    const frame = window.requestAnimationFrame(() => {
      bar.dataset.ready = "true";
    });
    const watch = new ResizeObserver(place);
    watch.observe(row);
    return () => {
      window.cancelAnimationFrame(frame);
      watch.disconnect();
    };
  }, [active, remember]);

  return { box, thumb };
}

/**
 * A number that counts to its new value instead of jumping: from 0 when it
 * first shows (the globe's totals and the legend count up as it opens), and
 * from the old value when it changes (a delete, a save). Screen readers get
 * the final value only.
 */
export function CountUp({ value }: { value: number }) {
  const [shown, setShown] = useState(0);
  const current = useRef(0);

  useEffect(() => {
    const start = current.current;
    if (start === value) return;
    if (motionReduced()) {
      const id = window.requestAnimationFrame(() => {
        current.current = value;
        setShown(value);
      });
      return () => window.cancelAnimationFrame(id);
    }
    const began = performance.now();
    const length = Math.min(1100, 420 + Math.abs(value - start) * 30);
    let frame = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - began) / length);
      const eased = 1 - Math.pow(1 - p, 3);
      const next = Math.round(start + (value - start) * eased);
      current.current = next;
      setShown(next);
      if (p < 1) frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [value]);

  return (
    <>
      <span aria-hidden className="tnum">
        {shown}
      </span>
      <span className="sr-only">{value}</span>
    </>
  );
}
