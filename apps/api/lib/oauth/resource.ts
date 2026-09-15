import { mcpResourceUrl } from "./urls";

function normalizeResource(value: string) {
  return value.trim().replace(/\/$/, "");
}

/** Tom resource är tillåten (Claude skickar den ofta inte). */
export function resourceAllowed(origin: string, resource: string): boolean {
  const requested = normalizeResource(resource);
  if (!requested) return true;
  return requested === normalizeResource(mcpResourceUrl(origin));
}

export function canonicalMcpResource(origin: string) {
  return normalizeResource(mcpResourceUrl(origin));
}
