"use client";

/**
 * Create and edit. docs/filip-auth.md is the contract: POST /api/memories to
 * create, PATCH /api/memories/:id to change, all four fields required in both.
 * Partial updates do not exist.
 *
 * The limits below are the same ones packages/memory/src/validate.ts enforces,
 * checked in the same order (project, title, content, category), so the reader
 * sees the problem before the round trip instead of a bare INVALID_TITLE after
 * it. The server stays the authority: if it refuses anyway, its code and message
 * are shown as they came.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { CATEGORY_HINT, CATEGORY_LABEL, DISPLAY_ORDER, categoryVar } from "@/lib/categories";
import { createMemory, updateMemory, type MemoryFields } from "@/lib/api";
import { LIMITS, firstProblem } from "@/lib/validate-fields";
import { isApiError, type Category, type Memory } from "@/lib/types";
import { Button, CharCount, ErrorText, inputClass } from "./ui";

export type EditorTarget = { mode: "create"; project?: string } | { mode: "edit"; memory: Memory };

export function MemoryEditor({
  target,
  knownProjects,
  userId,
  onClose,
  onSaved,
}: {
  target: EditorTarget;
  knownProjects: readonly string[];
  userId: string;
  onClose: () => void;
  onSaved: (memory: Memory) => void;
}) {
  const existing = target.mode === "edit" ? target.memory : null;

  const [project, setProject] = useState(existing?.project ?? (target.mode === "create" ? target.project ?? "" : ""));
  const [category, setCategory] = useState<string>(existing?.category ?? "fact");
  const [title, setTitle] = useState(existing?.title ?? "");
  const [content, setContent] = useState(existing?.content ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ code?: string; message: string } | null>(null);
  const firstField = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    firstField.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const fields: MemoryFields = useMemo(
    () => ({ project: project.trim(), category, title: title.trim(), content: content.trim() }),
    [project, category, title, content],
  );

  const problem = firstProblem(fields);
  const unchanged =
    existing !== null &&
    existing.project === fields.project &&
    existing.category === fields.category &&
    existing.title === fields.title &&
    existing.content === fields.content;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (problem) {
      setError({ message: problem });
      return;
    }
    setBusy(true);
    setError(null);

    const result = existing
      ? await updateMemory(
          existing.id,
          fields,
          userId,
          existing.project !== fields.project,
        )
      : await createMemory(fields, userId);

    setBusy(false);
    if (isApiError(result)) {
      setError(result.error);
      return;
    }
    onSaved(result);
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-black/35 p-0 sm:items-center sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <form
        onSubmit={submit}
        role="dialog"
        aria-modal="true"
        aria-label={existing ? "Edit memory" : "New memory"}
        className="rise thin-scroll max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-t-2xl border border-line bg-surface p-5 shadow-2xl sm:rounded-2xl"
      >
        <div className="mb-4 flex items-baseline justify-between gap-3">
          <h2 className="text-base font-semibold">{existing ? "Edit memory" : "New memory"}</h2>
          {existing ? (
            <span className="font-mono text-[11px] text-ink-3">{existing.id}</span>
          ) : null}
        </div>

        <label className="mb-3 flex flex-col gap-1 text-sm">
          <span className="flex items-baseline justify-between">
            Project
            <CharCount value={project} max={LIMITS.project} />
          </span>
          <input
            ref={firstField}
            className={inputClass}
            list="known-projects"
            value={project}
            onChange={(event) => setProject(event.target.value)}
            placeholder="Project A"
            autoComplete="off"
          />
          <datalist id="known-projects">
            {knownProjects.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
          <span className="text-xs text-ink-3">
            Matched exactly and case sensitively. &quot;Project a&quot; is a different project from
            &quot;Project A&quot;.
          </span>
        </label>

        <fieldset className="mb-3">
          <legend className="mb-1.5 text-sm">Category</legend>
          <div className="flex flex-wrap gap-1.5">
            {DISPLAY_ORDER.map((value: Category) => {
              const active = category === value;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => setCategory(value)}
                  aria-pressed={active}
                  title={CATEGORY_HINT[value]}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors ${
                    active
                      ? "border-line-2 bg-surface-3 text-ink"
                      : "border-line bg-surface text-ink-2 hover:bg-surface-2"
                  }`}
                >
                  <span
                    aria-hidden
                    className="size-2 rounded-full"
                    style={{ background: categoryVar(value) }}
                  />
                  {CATEGORY_LABEL[value]}
                </button>
              );
            })}
          </div>
          <p className="mt-1.5 text-xs text-ink-3">{CATEGORY_HINT[category as Category]}</p>
        </fieldset>

        <label className="mb-3 flex flex-col gap-1 text-sm">
          <span className="flex items-baseline justify-between">
            Title
            <CharCount value={title} max={LIMITS.title} />
          </span>
          <input
            className={inputClass}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Launch date"
          />
        </label>

        <label className="mb-4 flex flex-col gap-1 text-sm">
          <span className="flex items-baseline justify-between">
            Content
            <CharCount value={content} max={LIMITS.content} />
          </span>
          <textarea
            className={`${inputClass} min-h-32 resize-y`}
            value={content}
            onChange={(event) => setContent(event.target.value)}
            placeholder="We launch on 15 October 2026."
          />
        </label>

        {error ? <ErrorText code={error.code} message={error.message} /> : null}

        <div className="mt-4 flex items-center justify-end gap-2">
          <Button variant="quiet" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy || Boolean(problem) || unchanged}>
            {busy ? "Saving…" : existing ? "Save changes" : "Save memory"}
          </Button>
        </div>

        {unchanged ? (
          <p className="mt-2 text-right text-xs text-ink-3">Nothing changed yet.</p>
        ) : null}
      </form>
    </div>
  );
}
