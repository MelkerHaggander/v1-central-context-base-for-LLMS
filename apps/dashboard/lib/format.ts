/** Visar `2026-09-10T12:00:00Z` som lokal tid, t.ex. `2026-09-10 14:00`. */
export function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

export function formatClock(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/**
 * Timestamps arrive as UTC without milliseconds (docs/contracts.md). MCP has been
 * observed sending them with milliseconds, so parsing must tolerate both; Date
 * does.
 */

/** Absolute, unambiguous, local: 2026-09-20 14:00. Used in tooltips and detail. */
export function formatDateTime(iso: string): string {
  return formatTimestamp(iso);
}

/** Short relative age in English. Falls back to the absolute date past a week. */
export function formatAge(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;

  const seconds = Math.round((now.getTime() - date.getTime()) / 1000);
  if (seconds < 0) return formatTimestamp(iso);
  if (seconds < 60) return "just now";

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;

  const days = Math.round(hours / 24);
  if (days <= 7) return `${days} d ago`;

  return formatTimestamp(iso).slice(0, 10);
}
