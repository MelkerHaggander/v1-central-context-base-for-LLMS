"use client";

/**
 * Which space the globe shows: Personal and every team the account is in.
 *
 * A segmented control, because the reader should see all their spaces at
 * once. Team names come from the proposed name column; without it a team is
 * called "Team". With many teams the row scrolls sideways instead of wrapping
 * over the globe.
 *
 * "+" creates a team and the people button opens the members panel. Both are
 * the proposal "Förslag: team och medlemmar": they show only when the server
 * answers the members endpoint, so today they exist in mock mode alone.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { createTeam, isMissingEndpoint } from "@/lib/api";
import { spaceLabel, TEAM_NAME_MAX, teamNameProblem } from "@/lib/insights";
import { LEAVE_MS } from "@/lib/motion";
import { isApiError, type Space } from "@/lib/types";
import { PeopleIcon, PlusIcon } from "./icons";
import { usePresence } from "./useMotion";
import { Button, ErrorText, inputClass, useSegmentThumb } from "./ui";

export function SpaceSwitch({
  spaces,
  active,
  userId,
  teams,
  teamOpen,
  onChange,
  onCreated,
  onTeam,
}: {
  spaces: readonly Space[];
  active: Space;
  userId: string;
  /** The server has the team endpoints. Without them there is nothing to click. */
  teams: boolean;
  teamOpen: boolean;
  onChange: (id: string) => void;
  onCreated: (space: Space) => void;
  onTeam: () => void;
}) {
  // The dark thumb slides to the space you pick.
  const { box, thumb } = useSegmentThumb(active.id, `space:${userId}`);
  return (
    <div className="flex max-w-[calc(100vw-2rem)] items-center gap-1 sm:max-w-md">
      {spaces.length < 2 ? (
        <p className="px-1 text-xs font-medium text-ink-2">{spaceLabel(active)}</p>
      ) : (
        <div
          ref={box}
          role="radiogroup"
          aria-label="Space"
          className="no-scrollbar relative inline-flex min-w-0 overflow-x-auto rounded-lg bg-surface-2 p-0.5"
        >
          <span ref={thumb} aria-hidden className="seg-thumb rounded-md bg-accent shadow-sm" />
          {spaces.map((space) => {
            const on = space.id === active.id;
            return (
              <button
                key={space.id}
                type="button"
                role="radio"
                aria-checked={on}
                data-active={on}
                onClick={() => onChange(space.id)}
                title={space.kind === "shared" ? `${spaceLabel(space)}: shared with the team` : "Only you can see these"}
                className={`press relative max-w-[10rem] shrink-0 truncate rounded-md px-3 py-1 text-xs ${
                  on ? "font-medium text-accent-ink" : "text-ink-2 hover:text-ink"
                }`}
              >
                {spaceLabel(space)}
              </button>
            );
          })}
        </div>
      )}

      {teams && active.kind === "shared" ? (
        <button
          type="button"
          onClick={onTeam}
          aria-pressed={teamOpen}
          aria-label={`Members of ${spaceLabel(active)}`}
          title="Members"
          className={`press fade-in grid size-7 shrink-0 place-items-center rounded-md ${
            teamOpen ? "bg-surface-2 text-ink" : "text-ink-2 hover:bg-surface-2 hover:text-ink"
          }`}
        >
          <PeopleIcon className="size-4" />
        </button>
      ) : null}

      {teams ? <NewTeam userId={userId} onCreated={onCreated} /> : null}
    </div>
  );
}

function NewTeam({ userId, onCreated }: { userId: string; onCreated: (space: Space) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ code?: string; message: string } | null>(null);
  const [missing, setMissing] = useState(false);
  const pop = usePresence(open, LEAVE_MS.menu);
  const box = useRef<HTMLDivElement | null>(null);

  const close = useCallback(() => {
    setOpen(false);
    setError(null);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (box.current && !box.current.contains(event.target as Node)) close();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, close]);

  const problem = teamNameProblem(name);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (problem) return;
    setBusy(true);
    setError(null);
    const result = await createTeam(name.trim(), userId);
    setBusy(false);
    if (isApiError(result)) {
      if (isMissingEndpoint(result.error)) setMissing(true);
      else setError(result.error);
      return;
    }
    setName("");
    setOpen(false);
    onCreated(result);
  }

  return (
    <div
      ref={box}
      className="relative shrink-0"
      onKeyDown={(event) => {
        // Handled here so Escape closes only this popover, not the side panel behind it.
        if (event.key !== "Escape" || !open) return;
        event.stopPropagation();
        close();
      }}
    >
      <button
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        aria-expanded={open}
        aria-label="New team"
        title="New team"
        className={`press grid size-7 place-items-center rounded-md text-ink-2 hover:bg-surface-2 hover:text-ink ${open ? "bg-surface-2 text-ink" : ""}`}
      >
        {/* The plus turns a quarter into an x-like tilt while the popover is open. */}
        <PlusIcon className={`size-4 transition-transform duration-200 ${open ? "rotate-45" : ""}`} />
      </button>
      {pop.mounted ? (
        <div
          inert={pop.leaving || undefined}
          className={`${pop.leaving ? "menu-out" : "menu-in"} absolute left-0 top-9 z-40 w-72 max-w-[calc(100vw-2rem)] origin-top-left rounded-xl border border-line bg-surface p-3 shadow-xl`}
        >
          {missing ? (
            <div className="text-xs text-ink-2">
              <p className="font-medium text-ink">Not on the server yet</p>
              <p className="mt-1">
                Creating teams is proposed to Alfredo but not built in the API. Until then teams are set up
                in the members file.
              </p>
            </div>
          ) : (
            <form onSubmit={submit} className="flex flex-col gap-2">
              <label htmlFor="new-team" className="text-xs font-medium text-ink-2">
                New team
              </label>
              <input
                id="new-team"
                className={inputClass}
                value={name}
                autoFocus
                placeholder="e.g. Launch crew"
                maxLength={TEAM_NAME_MAX + 20}
                onChange={(e) => setName(e.target.value)}
              />
              {name.length > 0 && problem ? <p className="fade-in text-xs text-danger">{problem}</p> : null}
              {error ? <ErrorText code={error.code} message={error.message} /> : null}
              <p className="text-xs text-ink-3">You are its first member. Add people from its members panel.</p>
              <div className="flex items-center gap-1">
                <Button type="submit" disabled={Boolean(problem) || busy} busy={busy}>
                  {busy ? "Creating…" : "Create team"}
                </Button>
                <Button type="button" variant="quiet" onClick={close}>
                  Cancel
                </Button>
              </div>
            </form>
          )}
        </div>
      ) : null}
    </div>
  );
}
