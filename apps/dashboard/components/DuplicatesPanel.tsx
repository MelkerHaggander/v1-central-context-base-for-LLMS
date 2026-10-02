"use client";

/**
 * Memories that look like the same thing saved twice, in one project.
 *
 * The contract only stops identical re-saves. "Launch is 15 October" next to
 * "We launch on the 15th" both survive, and after a few months that rot is
 * what makes a memory useless. This lists the pairs and lets the reader keep
 * one. It never deletes on its own, and it is a word overlap, not the brain.
 */

import { useState } from "react";
import { categoryVar, labelFor } from "@/lib/categories";
import { formatAge } from "@/lib/format";
import type { DuplicatePair } from "@/lib/insights";
import { LEAVE_MS } from "@/lib/motion";
import type { Memory } from "@/lib/types";
import { usePresenceList } from "./useMotion";
import { Button, ConfirmButton, PanelShell, Row } from "./ui";

export function DuplicatesPanel({
  pairs,
  spaceName,
  onOpen,
  onEdit,
  onDelete,
  onClose,
}: {
  pairs: readonly DuplicatePair[];
  spaceName: string;
  onOpen: (memory: Memory) => void;
  onEdit: (memory: Memory) => void;
  /** Undo queue: the row vanishes now and is deleted a few seconds later. */
  onDelete: (memories: readonly Memory[]) => void;
  onClose: () => void;
}) {
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());

  const visible = pairs.filter((p) => !dismissed.has(`${p.a.id}:${p.b.id}`));
  // A pair that is hidden or resolved closes instead of vanishing.
  const shown = usePresenceList(visible, (p) => `${p.a.id}:${p.b.id}`, LEAVE_MS.row);

  return (
    <PanelShell
      label="Possible duplicates"
      title={`Possible duplicates (${visible.length})`}
      subtitle={`${spaceName} · same project, same title or mostly the same words`}
      onClose={onClose}
    >

      {shown.length === 0 ? (
        <p className="fade-in px-5 py-10 text-center text-sm text-ink-3">
          Nothing looks duplicated in this space.
        </p>
      ) : (
        <ul className="flex flex-col px-5 pb-6">
          {shown.map(({ item: pair, key, leaving }, index) => (
            <Row key={key} leaving={leaving} index={index} className="border-b border-line last:border-0" innerClassName="py-5">
              <p className="mb-2 text-xs text-ink-3">
                {pair.a.project} · {pair.reason === "same title" ? "same title" : `${Math.round(pair.score * 100)}% same words`}
              </p>
              {[pair.a, pair.b].map((memory, i) => (
                <div key={memory.id} className={i === 0 ? "mb-3" : undefined}>
                  <button type="button" onClick={() => onOpen(memory)} className="press block w-full text-left">
                    <span className="flex items-center gap-1.5 text-sm font-medium">
                      <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: categoryVar(memory.category) }} />
                      <span className="truncate">{memory.title}</span>
                    </span>
                    <span className="mt-0.5 block text-xs text-ink-3">
                      {labelFor(memory.category)} · {i === 0 ? "older" : "newer"}, {formatAge(memory.created_at)}
                    </span>
                    <span className="mt-1 line-clamp-3 block text-xs text-ink-2">{memory.content}</span>
                  </button>
                  <div className="mt-1.5 flex items-center gap-1">
                    <Button variant="quiet" className="-ml-3" onClick={() => onEdit(memory)}>
                      Edit
                    </Button>
                    <ConfirmButton
                      idleLabel="Delete this one"
                      confirmLabel="Really delete"
                      onConfirm={() => onDelete([memory])}
                    />
                  </div>
                </div>
              ))}
              <button
                type="button"
                className="press text-xs text-ink-3 underline-offset-4 hover:text-ink hover:underline"
                onClick={() => setDismissed((prev) => new Set(prev).add(`${pair.a.id}:${pair.b.id}`))}
              >
                Not a duplicate, hide
              </button>
            </Row>
          ))}
        </ul>
      )}
    </PanelShell>
  );
}
