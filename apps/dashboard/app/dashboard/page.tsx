"use client";

import { GlobeView } from "@/components/GlobeView";
import { SessionGate } from "@/components/SessionGate";
import { TopBar } from "@/components/TopBar";
import { Button, ErrorText, Skeleton } from "@/components/ui";
import { displayApiError } from "@/lib/display-error";
import { useDeleteQueue } from "@/components/useDeleteQueue";
import { usePresenceList, useTrailing } from "@/components/useMotion";
import { useSpaces } from "@/components/useSpaces";
import { UNDO_DELAY_MS } from "@/lib/delete-queue";
import { LEAVE_MS } from "@/lib/motion";
import type { SessionUser } from "@/lib/types";

export default function DashboardPage() {
  return (
    <SessionGate>
      {(user) => (
        <>
          <TopBar email={user.email} />
          {/* key on the account: a different user gets a fresh globe, never a
              frame of the previous account's dots. */}
          <Spaces key={user.id} user={user} />
        </>
      )}
    </SessionGate>
  );
}

/**
 * v1.2: nothing can be listed without a space. GET /api/memories answers 400
 * INVALID_SPACE without space_id, so the globe waits for GET /api/spaces.
 */
function Spaces({ user }: { user: SessionUser }) {
  const spaces = useSpaces(user.id);
  const deletes = useDeleteQueue(user.id);
  // Toasts leave instead of vanishing: the last notice and failure are kept
  // while they fade, and an Undo toast falls away when it is used or runs out.
  const oldNotice = useTrailing(spaces.notice, LEAVE_MS.toast);
  const oldFailure = useTrailing(deletes.failure, LEAVE_MS.toast);
  const toasts = usePresenceList(deletes.pending.slice(-3), (b) => String(b.key), LEAVE_MS.toast);
  const notice = spaces.notice ?? oldNotice;
  const failure = deletes.failure ?? oldFailure;

  if (!spaces.ready) {
    return (
      <div className="grid flex-1 place-items-center">
        <Skeleton className="size-64 rounded-full" />
      </div>
    );
  }

  if (!spaces.active) {
    return (
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-3 px-5">
        <ErrorText
          code={spaces.error?.code}
          message={spaces.error?.message ?? "Your account is not in any space yet."}
        />
        <p className="text-sm text-ink-3">
          Memories live in a space: your personal one or the team&apos;s. Until your account is added
          to one there is nothing to show. Accounts are added to spaces by hand.
        </p>
        <Button variant="ghost" className="self-start" onClick={spaces.retry}>
          Try again
        </Button>
      </main>
    );
  }

  const toast =
    "toast pointer-events-auto relative flex items-center gap-3 overflow-hidden rounded-xl border border-line bg-surface px-4 py-2.5 text-sm shadow-xl";
  const toastButton = "press shrink-0 text-xs font-medium text-ink-2 underline underline-offset-4 hover:text-ink";

  return (
    <>
      {/* Notices sit above the legend, newest at the bottom. */}
      {/* One live region that stays mounted, so screen readers announce each
          toast as it is added. */}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-24 z-50 mx-auto flex w-fit max-w-[90%] flex-col items-center gap-2"
      >
        {notice ? (
          <div className={`${toast} ${spaces.notice ? "rise" : "fall"}`}>
            <span>{notice}</span>
            <button type="button" onClick={spaces.dismiss} className={toastButton}>
              OK
            </button>
          </div>
        ) : null}
        {failure ? (
          <div role="alert" className={`${toast} ${deletes.failure ? "rise" : "fall"} border-danger/40 text-danger`}>
            <span>
              {failure.failed.length === 1 && failure.batch.ids.length === 1
                ? `Could not delete ${failure.batch.label}. It is back.`
                : `${failure.failed.length} of ${failure.batch.ids.length} could not be deleted and are back.`}{" "}
              {failure.error ? displayApiError({ code: failure.error.code ?? "", message: failure.error.message }) : null}
            </span>
            <button type="button" onClick={deletes.dismissFailure} className={toastButton}>
              OK
            </button>
          </div>
        ) : null}
        {toasts.map(({ item: batch, key, leaving }) => (
          <div
            key={key}
            inert={leaving || undefined}
            className={`${toast} ${leaving ? "fall" : "rise"}`}
            // Reading or reaching for Undo stops the clock (WCAG 2.2.1).
            onMouseEnter={() => deletes.hold(batch.key)}
            onMouseLeave={() => deletes.release(batch.key)}
            onFocus={() => deletes.hold(batch.key)}
            onBlur={() => deletes.release(batch.key)}
          >
            <span className="min-w-0 truncate">Deleted {batch.label}</span>
            <button type="button" onClick={() => deletes.undo(batch.key)} className={toastButton}>
              Undo
            </button>
            {/* Time left to undo. It stops while the toast is hovered or focused, as the queue does. */}
            <span
              aria-hidden
              className="drain absolute inset-x-0 bottom-0 h-px bg-ink-3"
              style={{ "--drain": `${UNDO_DELAY_MS}ms` } as React.CSSProperties}
            />
          </div>
        ))}
      </div>
      <GlobeView
        // A new space is a new globe: fresh fetch, fresh camera, no dots from the other space.
        key={spaces.active.id}
        user={user}
        space={spaces.active}
        spaces={spaces.spaces}
        onSpace={spaces.choose}
        onSpacesChanged={spaces.reload}
        onRenamed={spaces.patch}
        hiddenIds={deletes.hidden}
        onDelete={deletes.request}
        onSaved={deletes.forget}
      />
    </>
  );
}
