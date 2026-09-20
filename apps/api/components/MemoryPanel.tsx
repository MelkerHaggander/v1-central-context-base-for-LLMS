"use client";

/**
 * The text side of the globe.
 *
 * Every dot on the sphere is also a row here, with its title, project, category,
 * both timestamps and its id. That is deliberate: colour and position are a fast
 * way to see shape, never the only way to read a value, and two of the six hues
 * sit below 3:1 contrast on the light surface. If it is on the globe it is
 * readable as text.
 *
 * Editing and deleting live here too. docs/filip-auth.md: PATCH and DELETE on
 * /api/memories/:id, cookie session, and a language model has no delete tool at
 * all.
 */

import { useMemo, useState } from "react";
import { deleteMemory } from "@/lib/api";
import { filterMemories } from "@/lib/aggregate";
import { categoryVar, labelFor } from "@/lib/categories";
import { formatAge, formatDateTime } from "@/lib/format";
import { isApiError, type Memory } from "@/lib/types";
import { Button, ConfirmButton, ErrorText, inputClass } from "./ui";

export function MemoryPanel({
  heading,
  subheading,
  memories,
  selectedId,
  userId,
  onSelect,
  onEdit,
  onCreate,
  onDeleted,
  onClose,
}: {
  heading: string;
  subheading?: string;
  memories: readonly Memory[];
  selectedId: string | null;
  userId: string;
  onSelect: (id: string | null) => void;
  onEdit: (memory: Memory) => void;
  onCreate: () => void;
  onDeleted: (id: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState<{ code?: string; message: string } | null>(null);

  const rows = useMemo(() => filterMemories(memories, { query }), [memories, query]);

  async function remove(memory: Memory) {
    setDeleting(memory.id);
    setError(null);
    const result = await deleteMemory(memory.id, userId);
    setDeleting(null);
    if (isApiError(result)) {
      setError(result.error);
      return;
    }
    onDeleted(memory.id);
  }

  return (
    <aside
      className="slide-in thin-scroll flex h-full w-full flex-col overflow-hidden border-line bg-surface sm:w-[26rem] sm:border-l"
      aria-label={heading}
    >
      <header className="flex items-start gap-2 border-b border-line px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold">{heading}</h2>
          <p className="tnum mt-0.5 text-xs text-ink-3">
            {memories.length} {memories.length === 1 ? "memory" : "memories"}
            {subheading ? ` · ${subheading}` : ""}
          </p>
        </div>
        <Button variant="quiet" onClick={onCreate} title="New memory in this project">
          New
        </Button>
        <Button variant="quiet" onClick={onClose} aria-label="Close panel">
          Close
        </Button>
      </header>

      {memories.length > 6 ? (
        <div className="border-b border-line px-4 py-2">
          <input
            className={inputClass}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter these memories"
          />
        </div>
      ) : null}

      {error ? (
        <div className="px-4 pt-3">
          <ErrorText code={error.code} message={error.message} />
        </div>
      ) : null}

      <div className="thin-scroll flex-1 overflow-y-auto">
        {rows.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-ink-3">
            {memories.length === 0 ? "Nothing here yet." : "No memory matches that filter."}
          </p>
        ) : (
          <ul>
            {rows.map((memory) => {
              const open = memory.id === selectedId;
              return (
                <li key={memory.id} className="border-b border-line last:border-0">
                  <button
                    type="button"
                    onClick={() => onSelect(open ? null : memory.id)}
                    aria-expanded={open}
                    className={`flex w-full items-start gap-2.5 px-4 py-3 text-left transition-colors ${
                      open ? "bg-surface-2" : "hover:bg-surface-2"
                    }`}
                  >
                    <span
                      aria-hidden
                      className="mt-1.5 size-2 shrink-0 rounded-full"
                      style={{ background: categoryVar(memory.category) }}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{memory.title}</span>
                      <span className="mt-0.5 block truncate text-xs text-ink-3">
                        {labelFor(memory.category)} · {memory.project} ·{" "}
                        <time dateTime={memory.created_at} title={`Created ${formatDateTime(memory.created_at)}`}>
                          {formatAge(memory.created_at)}
                        </time>
                      </span>
                    </span>
                  </button>

                  {open ? (
                    <div className="px-4 pb-4">
                      <p className="whitespace-pre-wrap text-sm text-ink-2">{memory.content}</p>
                      <dl className="tnum mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-ink-3">
                        <dt>Created</dt>
                        <dd>{formatDateTime(memory.created_at)}</dd>
                        <dt>Updated</dt>
                        <dd>{formatDateTime(memory.updated_at)}</dd>
                        <dt>Source</dt>
                        <dd title="The memories table has no column for the client that wrote the row.">
                          not recorded
                        </dd>
                        <dt>Id</dt>
                        <dd className="font-mono break-all">{memory.id}</dd>
                      </dl>
                      <div className="mt-3 flex items-center justify-end gap-1">
                        <Button variant="ghost" onClick={() => onEdit(memory)}>
                          Edit
                        </Button>
                        <ConfirmButton
                          busy={deleting === memory.id}
                          onConfirm={() => void remove(memory)}
                        />
                      </div>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}
