"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, ErrorText } from "@/components/ui";
import type { McpConnection } from "@/lib/oauth/mcp-connections";
import { isApiError, type ApiError } from "@/lib/types";

type Listed = { connections: McpConnection[] };

async function readJson(path: string, init?: RequestInit): Promise<Listed | { removed: true } | ApiError> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      credentials: "include",
      cache: "no-store",
      headers: { Accept: "application/json", ...(init?.headers ?? {}) },
    });
  } catch {
    return { error: { code: "NETWORK_ERROR", message: "Could not reach the server." } };
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { error: { code: "INVALID_RESPONSE", message: "The server answered without valid JSON." } };
  }
  if (isApiError(body)) return body;
  if (!response.ok) {
    return { error: { code: `HTTP_${response.status}`, message: `The server answered ${response.status}.` } };
  }
  return body as Listed | { removed: true };
}

function whenConnected(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
}

export function McpConnections() {
  const [rows, setRows] = useState<McpConnection[] | null>(null);
  const [error, setError] = useState<ApiError["error"] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);

  const load = useCallback(async () => {
    const result = await readJson("/api/mcp/connections");
    if (isApiError(result)) {
      setError(result.error);
      setRows([]);
      return;
    }
    if (!("connections" in result) || !Array.isArray(result.connections)) {
      setError({ code: "CONNECTIONS_FAILED", message: "Could not load the connections." });
      setRows([]);
      return;
    }
    setError(null);
    setRows(result.connections);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function removeOne(id: string) {
    setBusy(id);
    setConfirmAll(false);
    const result = await readJson("/api/mcp/connections", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    setBusy(null);
    if (isApiError(result)) {
      setError(result.error);
      return;
    }
    await load();
  }

  async function removeAll() {
    if (!confirmAll) {
      setConfirmAll(true);
      return;
    }
    setBusy("all");
    const result = await readJson("/api/mcp/connections", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ all: true }),
    });
    setBusy(null);
    setConfirmAll(false);
    if (isApiError(result)) {
      setError(result.error);
      return;
    }
    await load();
  }

  return (
    <section className="mt-8 rounded-xl border border-line bg-surface px-4 py-3 text-sm">
      <h2 className="font-medium">Remove a connection</h2>
      <p className="mt-1 text-ink-2">
        A connection stays on until you remove it here. It does not stop after an hour. Remove it
        when a computer is lost or a connection is not yours. The address stays the same. Sign in
        again only for the connection you removed.
      </p>
      {error ? (
        <div className="mt-3">
          <ErrorText code={error.code} message={error.message} />
        </div>
      ) : null}
      {rows === null ? <p className="mt-3 text-ink-2">Loading connections…</p> : null}
      {rows?.length === 0 && !error ? (
        <p className="mt-3 text-ink-2">No chat is connected.</p>
      ) : null}
      {rows && rows.length > 0 ? (
        <ul className="mt-3 flex flex-col gap-2">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center justify-between gap-2">
              <span>Connected {whenConnected(row.created_at)}</span>
              <Button
                type="button"
                variant="danger"
                busy={busy === row.id}
                disabled={busy !== null}
                onClick={() => void removeOne(row.id)}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      {rows && rows.length > 0 ? (
        <div className="mt-3">
          <Button
            type="button"
            variant="danger"
            busy={busy === "all"}
            disabled={busy !== null}
            onClick={() => void removeAll()}
          >
            {confirmAll ? "Remove all connections now" : "Remove all"}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
