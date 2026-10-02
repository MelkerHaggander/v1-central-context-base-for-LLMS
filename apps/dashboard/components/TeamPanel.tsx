"use client";

/**
 * One team: its name and who is in it.
 *
 * Built against the proposal "Förslag: team och medlemmar" (Confluence). Mock
 * and live API both support members list, create, rename, add and remove.
 *
 * Rules, the same in the mock and in the proposal:
 * - everyone in a team has the same rights (Backend features, Utrymmen), so
 *   any member can rename, add and remove, including themselves;
 * - only existing accounts can be added, since accounts are created by hand;
 * - the last member cannot leave, so a team is never an orphan;
 * - memories stay in the team when someone leaves, and the history keeps who
 *   changed what.
 */

import { useState } from "react";
import { addMember, isMissingEndpoint, removeMember, renameTeam } from "@/lib/api";
import { looksLikeEmail, spaceLabel, TEAM_NAME_MAX, teamNameProblem } from "@/lib/insights";
import { LEAVE_MS } from "@/lib/motion";
import { isApiError, type Space } from "@/lib/types";
import { Button, CharCount, ConfirmButton, ErrorText, inputClass, PanelShell, Row, Skeleton, Tag } from "./ui";
import type { MembersState } from "./useMembers";
import { usePresenceList } from "./useMotion";

type Problem = { code?: string; message: string } | null;

export function TeamPanel({
  space,
  userId,
  members,
  onRenamed,
  onLeft,
  onClose,
}: {
  space: Space;
  userId: string;
  members: MembersState;
  onRenamed: (space: Space) => void;
  /** Refetch the spaces. On success this panel unmounts with its globe. */
  onLeft: () => Promise<void> | void;
  onClose: () => void;
}) {
  const [name, setName] = useState(space.name ?? "");
  const [renaming, setRenaming] = useState(false);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<Problem>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);

  const list = members.members;
  const count = list?.length ?? 0;
  // Someone removed or added: their row closes or rises instead of jumping.
  const shownMembers = usePresenceList(list ?? [], (m) => m.user_id, LEAVE_MS.row);
  // No list at all: nothing to show. No writes: show the list, read only.
  const offline = members.missing;
  const readOnly = offline || missing;
  const nameProblem = teamNameProblem(name);
  const nameChanged = name.trim() !== (space.name ?? "").trim();

  function fail(problem: { code: string; message: string }) {
    if (isMissingEndpoint(problem)) setMissing(true);
    else setError(problem);
  }

  async function saveName(event: React.FormEvent) {
    event.preventDefault();
    if (nameProblem || !nameChanged) return;
    setBusy("rename");
    setError(null);
    setNotice(null);
    const result = await renameTeam(space.id, name.trim(), userId);
    setBusy(null);
    if (isApiError(result)) return fail(result.error);
    setRenaming(false);
    onRenamed({ ...space, name: result.name ?? name.trim() });
    setNotice("Renamed. Everyone in the team sees the new name.");
  }

  async function add(event: React.FormEvent) {
    event.preventDefault();
    if (!looksLikeEmail(email)) {
      setError({ code: "INVALID_EMAIL", message: "That is not an email address." });
      return;
    }
    setBusy("add");
    setError(null);
    setNotice(null);
    const result = await addMember(space.id, email.trim(), userId);
    setBusy(null);
    if (isApiError(result)) return fail(result.error);
    setEmail("");
    setNotice(`${result.email} is in. They see this team the next time they load the dashboard.`);
    await members.reload();
  }

  async function remove(memberId: string, self: boolean) {
    setBusy(memberId);
    setError(null);
    setNotice(null);
    const result = await removeMember(space.id, memberId, userId);
    if (isApiError(result)) {
      setBusy(null);
      return fail(result.error);
    }
    if (self) {
      // Stay busy until the spaces are refetched: a second "Really leave"
      // would send another DELETE for someone who is no longer in the team.
      await onLeft();
      // Still here means the refetch did not move us, most likely it failed.
      setBusy(null);
      setNotice("You have left the team. If it is still in the switcher, reload the page.");
      return;
    }
    setBusy(null);
    setNotice("Removed. Their memories stay in the team.");
    await members.reload();
  }

  return (
    <PanelShell
      label="Team"
      title={spaceLabel(space)}
      subtitle={offline ? "Team" : list ? `${count} ${count === 1 ? "member" : "members"} · same rights for all` : "Team"}
      onClose={onClose}
    >
      <div className="flex flex-col gap-6 px-4 pb-6">
        {readOnly ? (
          <div className="rounded-lg border border-line bg-surface-2 px-3 py-2.5 text-xs text-ink-2">
            <p className="font-medium text-ink">Not on the server yet</p>
            <p className="mt-1">
              {offline
                ? "The server does not list team members yet. Members are added to a team by hand in the database."
                : "That action is not available on the server yet. The list below is read only."}
            </p>
          </div>
        ) : null}

        {error ? <ErrorText code={error.code} message={error.message} /> : null}
        {notice ? (
          <p key={notice} role="status" className="rise text-xs text-ink-2">
            {notice}
          </p>
        ) : null}

        {!offline ? (
          <section aria-labelledby="team-name">
            <h3 id="team-name" className="text-xs font-medium text-ink-3">
              Name
            </h3>
            {renaming && !readOnly ? (
              <form onSubmit={saveName} className="fade-in mt-1.5 flex flex-col gap-2">
                <input
                  id="team-rename"
                  className={inputClass}
                  value={name}
                  autoFocus
                  maxLength={TEAM_NAME_MAX + 20}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    // Escape cancels the rename and stops there, instead of
                    // also closing the panel through the globe's handler.
                    if (e.key !== "Escape") return;
                    e.stopPropagation();
                    setRenaming(false);
                    setName(space.name ?? "");
                  }}
                  aria-labelledby="team-name"
                  aria-invalid={Boolean(nameProblem) && name.length > 0}
                  aria-describedby={nameProblem && name.length > 0 ? "team-rename-problem" : undefined}
                />
                <div className="flex items-center gap-1">
                  <Button
                    type="submit"
                    disabled={Boolean(nameProblem) || !nameChanged || busy === "rename"}
                    busy={busy === "rename"}
                  >
                    {busy === "rename" ? "Saving…" : "Save"}
                  </Button>
                  <Button
                    type="button"
                    variant="quiet"
                    onClick={() => {
                      setRenaming(false);
                      setName(space.name ?? "");
                    }}
                  >
                    Cancel
                  </Button>
                  <span className="ml-auto">
                    <CharCount value={name} max={TEAM_NAME_MAX} />
                  </span>
                </div>
                {nameProblem && name.length > 0 ? (
                  <p id="team-rename-problem" className="fade-in text-xs text-danger">
                    {nameProblem}
                  </p>
                ) : null}
              </form>
            ) : (
              <div className="fade-in mt-1 flex items-center gap-2">
                <p key={spaceLabel(space)} className="rise min-w-0 flex-1 truncate text-sm">
                  {spaceLabel(space)}
                </p>
                {readOnly ? null : (
                  <Button variant="quiet" className="-mr-2" onClick={() => setRenaming(true)}>
                    Rename
                  </Button>
                )}
              </div>
            )}
          </section>
        ) : null}

        {!offline ? (
          <section aria-labelledby="team-members">
            <h3 id="team-members" className="text-xs font-medium text-ink-3">
              Members
            </h3>
            {members.error ? (
              <div className="mt-2">
                <ErrorText code={members.error.code} message={members.error.message} />
              </div>
            ) : !list ? (
              <Skeleton className="mt-2 h-16 w-full" />
            ) : (
              <ul className="mt-1 flex flex-col">
                {shownMembers.map(({ item: member, leaving }, index) => {
                  const self = member.user_id === userId;
                  const last = count === 1;
                  return (
                    <Row
                      key={member.user_id}
                      leaving={leaving}
                      index={index}
                      className="border-b border-line last:border-0"
                      innerClassName="flex min-h-10 items-center gap-2 py-1.5"
                    >
                      <span className="min-w-0 flex-1 truncate text-sm" title={member.email}>
                        {member.email}
                      </span>
                      {self ? <Tag>You</Tag> : null}
                      {last || readOnly ? null : (
                        <ConfirmButton
                          idleLabel={self ? "Leave" : "Remove"}
                          confirmLabel={self ? "Really leave" : "Really remove"}
                          busyLabel={self ? "Leaving…" : "Removing…"}
                          busy={busy === member.user_id}
                          onConfirm={() => void remove(member.user_id, self)}
                        />
                      )}
                    </Row>
                  );
                })}
              </ul>
            )}
            {count === 1 && !readOnly ? (
              <p className="mt-2 text-xs text-ink-3">You are the only member. A team is never left empty, so you cannot leave it.</p>
            ) : null}
          </section>
        ) : null}

        {!readOnly ? (
          <section aria-labelledby="team-add">
            <h3 id="team-add" className="text-xs font-medium text-ink-3">
              Add someone
            </h3>
            <form onSubmit={add} className="mt-1.5 flex flex-col gap-2">
              <input
                className={inputClass}
                type="email"
                inputMode="email"
                autoComplete="off"
                placeholder="name@example.com"
                aria-labelledby="team-add"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => {
                  // First Escape clears what was typed; an empty field lets it close the panel.
                  if (e.key !== "Escape" || !email) return;
                  e.stopPropagation();
                  setEmail("");
                }}
              />
              <Button type="submit" className="self-start" disabled={!email.trim() || busy === "add"} busy={busy === "add"}>
                {busy === "add" ? "Adding…" : "Add to team"}
              </Button>
            </form>
            <p className="mt-2 text-xs text-ink-3">
              Only existing accounts. There is no sign-up; accounts are created by hand.
            </p>
          </section>
        ) : null}

        <section className="text-xs text-ink-3">
          <p>
            Everyone in a team can read, add, edit and delete its memories, rename it and manage who is in
            it. Someone who leaves loses access; their memories stay, and the history still shows what they
            changed.
          </p>
          <p className="mt-2">
            This only steers the dashboard. A chat saves to your personal space unless you ask it to save
            for the team, whichever space you look at here.
          </p>
        </section>
      </div>
    </PanelShell>
  );
}
