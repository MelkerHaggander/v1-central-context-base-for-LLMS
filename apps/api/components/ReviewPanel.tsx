"use client";

/**
 * The review inbox: what the AI saved on its own and this reader has not yet
 * looked at (lib/review.ts). Each one is shown in full, because reviewing
 * means reading the text the AI will get. Keep marks it reviewed; Edit and
 * Delete go through the normal editor and the undo queue.
 */

import { categoryVar, labelFor } from "@/lib/categories";
import { formatAge } from "@/lib/format";
import { LEAVE_MS } from "@/lib/motion";
import type { Memory } from "@/lib/types";
import { usePresenceList } from "./useMotion";
import { Button, ConfirmButton, PanelShell, Row } from "./ui";

export function ReviewPanel({
  memories,
  spaceName,
  onKeep,
  onEdit,
  onDelete,
  onOpen,
  onClose,
}: {
  memories: readonly Memory[];
  spaceName: string;
  onKeep: (memories: readonly Memory[]) => void;
  onEdit: (memory: Memory) => void;
  onDelete: (memories: readonly Memory[]) => void;
  onOpen: (memory: Memory) => void;
  onClose: () => void;
}) {
  // Kept, fixed or deleted: the row closes and the next one moves up.
  const shown = usePresenceList(memories, (m) => m.id, LEAVE_MS.row);
  return (
    <PanelShell
      label="Saved by the AI"
      title={`Saved by the AI (${memories.length})`}
      subtitle={`${spaceName} · written from chats, not yet reviewed`}
      actions={
        memories.length > 1 ? (
          <Button variant="quiet" className="px-2" onClick={() => onKeep(memories)}>
            Keep all
          </Button>
        ) : undefined
      }
      onClose={onClose}
    >
      {shown.length === 0 ? (
        <p className="fade-in px-5 py-10 text-center text-sm text-ink-3">
          Nothing to review. Everything the AI saved here has been looked at.
        </p>
      ) : (
        <ul className="flex flex-col px-4 pb-4">
          {shown.map(({ item: m, leaving }, index) => (
            <Row key={m.id} leaving={leaving} index={index} className="border-b border-line last:border-0" innerClassName="py-3">
              <button type="button" onClick={() => onOpen(m)} className="press block w-full text-left">
                <span className="flex items-center gap-1.5 text-sm font-medium">
                  <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: categoryVar(m.category) }} />
                  <span className="truncate">{m.title}</span>
                </span>
                <span className="mt-0.5 block text-xs text-ink-3">
                  {labelFor(m.category)}
                  {m.project.trim() ? ` · ${m.project}` : ""} · {formatAge(m.updated_at)}
                </span>
              </button>
              <p className="mt-1.5 whitespace-pre-wrap text-xs text-ink-2">{m.content}</p>
              <div className="-ml-3 mt-1.5 flex items-center gap-0.5">
                <Button variant="quiet" onClick={() => onKeep([m])}>
                  Keep
                </Button>
                <Button variant="quiet" onClick={() => onEdit(m)}>
                  Edit
                </Button>
                <ConfirmButton onConfirm={() => onDelete([m])} />
              </div>
            </Row>
          ))}
        </ul>
      )}
      <p className="px-4 pb-6 text-xs text-ink-3">
        Every chat can save memories on its own, and a wrong one becomes wrong context in every later chat.
        Keep what is right, fix or delete the rest. If a memory changes after you kept it, it comes back here.
        What you have reviewed is remembered in this browser.
      </p>
    </PanelShell>
  );
}
