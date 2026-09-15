/**
 * En webbläsare = en cookie-session. Två flikar kan inte vara två konton.
 * sessionStorage är däremot per flik. Vi låser varje flik till det konto den
 * först såg, så en inloggning i flik 2 inte kan visa/blanda minnen i flik 1.
 */

export const TAB_USER_KEY = "v1_tab_user_id";
export const SESSION_CHANNEL = "v1-session";
export const SESSION_PING_KEY = "v1-session-ping";
export const USER_ID_HEADER = "X-V1-User-Id";

export type TabSessionDecision =
  | { action: "signed-out" }
  | { action: "bind"; userId: string }
  | { action: "ok"; userId: string }
  | { action: "mismatch"; boundId: string; cookieUserId: string };

export function decideTabSession(
  boundId: string | null,
  cookieUserId: string | null,
): TabSessionDecision {
  if (!cookieUserId) return { action: "signed-out" };
  if (!boundId) return { action: "bind", userId: cookieUserId };
  if (boundId !== cookieUserId) {
    return { action: "mismatch", boundId, cookieUserId };
  }
  return { action: "ok", userId: boundId };
}

/** Tom header (äldre deploy) räknas inte som läcka. Avvikande id får inte visas. */
export function memoryBelongsToTab(expectedUserId: string, responseUserId: string | null): boolean {
  if (!responseUserId) return true;
  return expectedUserId === responseUserId;
}

export function getBoundTabUser(): string | null {
  try {
    return sessionStorage.getItem(TAB_USER_KEY);
  } catch {
    return null;
  }
}

export function bindTabUser(userId: string) {
  try {
    sessionStorage.setItem(TAB_USER_KEY, userId);
  } catch {
    /* private mode */
  }
}

export function clearBoundTabUser() {
  try {
    sessionStorage.removeItem(TAB_USER_KEY);
  } catch {
    /* private mode */
  }
}

export function notifySessionChanged() {
  try {
    const ch = new BroadcastChannel(SESSION_CHANNEL);
    ch.postMessage({ t: Date.now() });
    ch.close();
  } catch {
    /* unsupported */
  }
  try {
    localStorage.setItem(SESSION_PING_KEY, String(Date.now()));
  } catch {
    /* private mode */
  }
}

export function subscribeSessionChanged(onChange: () => void): () => void {
  let ch: BroadcastChannel | null = null;
  try {
    ch = new BroadcastChannel(SESSION_CHANNEL);
    ch.onmessage = () => onChange();
  } catch {
    ch = null;
  }
  const onStorage = (event: StorageEvent) => {
    if (event.key === SESSION_PING_KEY) onChange();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    ch?.close();
    window.removeEventListener("storage", onStorage);
  };
}
