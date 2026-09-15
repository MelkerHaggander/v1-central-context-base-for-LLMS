"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { searchMemories } from "@/lib/api";
import { formatClock, formatTimestamp } from "@/lib/format";
import { CATEGORIES, CATEGORY_LABELS, PAGE_SIZE, type Category, type Memory } from "@/lib/types";
import { Button, ErrorText, inputClass } from "./ui";

const REFRESH_MS = 10_000;

export function MemoryList({ userId }: { userId: string }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [project, setProject] = useState("");
  const [category, setCategory] = useState<"" | Category>("");
  const [offset, setOffset] = useState(0);

  const [memories, setMemories] = useState<Memory[] | null>(null);
  const [error, setError] = useState<{ code?: string; message: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchedAt, setFetchedAt] = useState<Date | null>(null);
  const [knownProjects, setKnownProjects] = useState<string[]>([]);

  // Senaste anropet vinner. Ett långsamt svar får inte skriva över ett nyare.
  const seq = useRef(0);

  const load = useCallback(async () => {
    const my = ++seq.current;
    setLoading(true);
    const result = await searchMemories({
      query: query.trim() || undefined,
      project: project || undefined,
      category: category || undefined,
      offset: offset || undefined,
      expectedUserId: userId,
    });
    if (my !== seq.current) return;
    setLoading(false);

    if ("error" in result) {
      setMemories(null);
      setKnownProjects([]);
      if (result.error.code === "UNAUTHENTICATED" || result.error.code === "ACCOUNT_SWITCHED") {
        router.replace(result.error.code === "ACCOUNT_SWITCHED" ? "/dashboard" : "/");
        return;
      }
      setError(result.error);
      return;
    }
    setError(null);
    setMemories(result);
    setFetchedAt(new Date());
    const projects = new Set<string>();
    result.forEach((m) => projects.add(m.project));
    setKnownProjects([...projects].sort((a, b) => a.localeCompare(b, "sv")));
  }, [query, project, category, offset, router, userId]);

  // Ny sökning/filter -> hämta direkt (liten fördröjning på textsök).
  useEffect(() => {
    const t = setTimeout(load, query ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, query]);

  // Var 10:e sekund när fliken är synlig. Pausar när den är dold, hämtar när den blir synlig igen.
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer) return;
      timer = setInterval(() => {
        if (document.visibilityState === "visible") load();
      }, REFRESH_MS);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        load();
        start();
      } else {
        stop();
      }
    };
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [load]);

  const hasFilter = Boolean(query.trim() || project || category);
  const emptyText = useMemo(() => {
    if (memories === null) return null;
    if (memories.length > 0) return null;
    if (offset > 0) return "Inga fler minnen på den här sidan.";
    return hasFilter ? "Inga minnen matchar sökningen." : "Inga minnen än. Be Claude komma ihåg något.";
  }, [memories, hasFilter, offset]);

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-56 flex-1 flex-col gap-1 text-sm">
          Sök i titel och innehåll
          <input
            className={inputClass}
            type="search"
            placeholder="t.ex. oktober"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOffset(0);
            }}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Projekt
          <select
            className={inputClass}
            value={project}
            onChange={(e) => {
              setProject(e.target.value);
              setOffset(0);
            }}
          >
            <option value="">Alla projekt</option>
            {knownProjects.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Kategori
          <select
            className={inputClass}
            value={category}
            onChange={(e) => {
              setCategory(e.target.value as "" | Category);
              setOffset(0);
            }}
          >
            <option value="">Alla kategorier</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
        </label>
        <Button variant="ghost" type="button" onClick={load} disabled={loading}>
          {loading ? "Hämtar…" : "Uppdatera"}
        </Button>
      </div>

      <p className="text-xs text-muted">
        Senast uppdaterat först. Hämtas automatiskt var 10:e sekund när fliken är aktiv.
        {fetchedAt ? ` Senast hämtat ${formatClock(fetchedAt)}.` : ""}
      </p>

      {error ? <ErrorText code={error.code} message={error.message} /> : null}

      {memories === null && !error ? (
        <p className="text-sm text-muted">Hämtar minnen…</p>
      ) : null}

      {emptyText ? (
        <p className="rounded-md border border-dashed border-line px-4 py-8 text-center text-sm text-muted">
          {emptyText}
        </p>
      ) : null}

      {memories && memories.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {memories.map((m) => (
            <MemoryCard key={m.id} memory={m} />
          ))}
        </ul>
      ) : null}

      {memories && (offset > 0 || memories.length === PAGE_SIZE) ? (
        <div className="flex items-center gap-2 text-sm">
          <Button
            variant="ghost"
            type="button"
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
          >
            Föregående
          </Button>
          <span className="text-muted">
            Rad {offset + 1}–{offset + memories.length}
          </span>
          <Button
            variant="ghost"
            type="button"
            disabled={memories.length < PAGE_SIZE}
            onClick={() => setOffset(offset + PAGE_SIZE)}
          >
            Nästa
          </Button>
        </div>
      ) : null}
    </section>
  );
}

function MemoryCard({ memory }: { memory: Memory }) {
  return (
    <li className="rounded-lg border border-line bg-panel px-4 py-3">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
        <span className="rounded bg-accent-soft px-2 py-0.5 font-medium text-accent">
          {CATEGORY_LABELS[memory.category] ?? memory.category}
        </span>
        <span>{memory.project}</span>
        <span className="ml-auto" title={`Uppdaterad ${memory.updated_at}`}>
          {formatTimestamp(memory.updated_at)}
        </span>
      </div>
      <h3 className="mt-1 font-medium">{memory.title}</h3>
      <p className="mt-1 whitespace-pre-wrap text-sm">{memory.content}</p>
      <p className="mt-2 font-mono text-[11px] text-muted">{memory.id}</p>
    </li>
  );
}
