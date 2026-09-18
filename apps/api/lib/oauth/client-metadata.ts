import { isIP } from "node:net";
import { lookup } from "node:dns/promises";

const MAX_CLIENT_METADATA_BYTES = 64 * 1024;
const FETCH_TIMEOUT_MS = 5_000;

const ALLOWED_HOSTS = new Set([
  "claude.ai",
  "claude.com",
  "anthropic.com",
  "openai.com",
  "chatgpt.com",
  "grok.com",
  "x.ai",
]);

const ALLOWED_SUFFIXES = [
  ".claude.ai",
  ".claude.com",
  ".anthropic.com",
  ".openai.com",
  ".chatgpt.com",
  ".grok.com",
  ".x.ai",
] as const;

export type LookupAddresses = (hostname: string) => Promise<string[]>;

export function isPrivateOrReservedIp(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) {
    const parts = ip.split(".").map(Number);
    const [a, b] = parts;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a >= 224) return true;
    return false;
  }
  if (version === 6) {
    const lower = ip.toLowerCase();
    if (lower === "::1" || lower === "::") return true;
    if (lower.startsWith("::ffff:")) {
      const mapped = lower.slice("::ffff:".length);
      if (isIP(mapped) === 4) return isPrivateOrReservedIp(mapped);
    }
    if (lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb")) {
      return true;
    }
    if (lower.startsWith("fc") || lower.startsWith("fd") || lower.startsWith("ff")) return true;
    return false;
  }
  return true;
}

function hostIsAllowed(host: string): boolean {
  if (ALLOWED_HOSTS.has(host)) return true;
  return ALLOWED_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

export function isAllowedClientMetadataUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  if (url.username || url.password) return false;
  if (url.port && url.port !== "443") return false;
  const host = url.hostname.toLowerCase();
  if (!host || host.endsWith(".")) return false;
  if (isIP(host) || host === "localhost" || host.endsWith(".localhost") || host === "metadata.google.internal") {
    return false;
  }
  return hostIsAllowed(host);
}

async function lookupHostIps(hostname: string): Promise<string[]> {
  const records = await lookup(hostname, { all: true });
  return records.map((row) => row.address);
}

export async function fetchClientMetadata(
  clientId: string,
  options: {
    fetchImpl?: typeof fetch;
    lookupImpl?: LookupAddresses;
  } = {},
): Promise<{ client_id: string; redirect_uris: string[] } | null> {
  if (!isAllowedClientMetadataUrl(clientId)) return null;
  const url = new URL(clientId);
  const lookupImpl = options.lookupImpl ?? lookupHostIps;
  let addresses: string[];
  try {
    addresses = await lookupImpl(url.hostname);
  } catch {
    return null;
  }
  if (!addresses.length || addresses.some(isPrivateOrReservedIp)) return null;

  const fetchImpl = options.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl(clientId, {
      headers: { accept: "application/json" },
      cache: "no-store",
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    if (!isAllowedClientMetadataUrl(response.url || clientId)) return null;
    const advertised = Number(response.headers.get("content-length") ?? "0");
    if (advertised > MAX_CLIENT_METADATA_BYTES) return null;
    const text = await response.text();
    if (text.length > MAX_CLIENT_METADATA_BYTES) return null;
    const body = JSON.parse(text) as { redirect_uris?: unknown };
    const uris = body.redirect_uris;
    if (!Array.isArray(uris) || uris.length === 0 || uris.some((item) => typeof item !== "string")) {
      return null;
    }
    return { client_id: clientId, redirect_uris: uris };
  } catch {
    return null;
  }
}
