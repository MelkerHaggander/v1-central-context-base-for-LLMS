import { AsyncLocalStorage } from "node:async_hooks";
import { publicOrigin } from "@/lib/oauth/urls";

const store = new AsyncLocalStorage<{ origin: string }>();

export function runMcpRequest<T>(req: Request, fn: () => T): T {
  return store.run({ origin: publicOrigin(req) }, fn);
}

export function mcpOrigin(): string {
  return store.getStore()?.origin || "";
}
