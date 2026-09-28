/** Identity boundaries tell later caches and capture-file owners when to clear data. */
export interface SessionEvent {
  type: "signed_out" | "context_changed";
  accountId: string | null;
  previousCompanyId: string | null;
  companyId: string | null;
}
type Handler = (event: SessionEvent) => void | Promise<void>;
const handlers = new Map<SessionEvent["type"], Set<Handler>>();
const signOutTasks = new Set<() => void | Promise<void>>();
/** Returns explicit teardown so subscribers do not survive their owners. */
export function subscribe(
  type: SessionEvent["type"],
  handler: Handler,
): () => void {
  const set = handlers.get(type) ?? new Set<Handler>();
  set.add(handler);
  handlers.set(type, set);
  return () => {
    set.delete(handler);
  };
}
/** Cleanup hooks run independently so one failure cannot suppress another. */
export function registerSignOutTask(
  task: () => void | Promise<void>,
): () => void {
  signOutTasks.add(task);
  return () => {
    signOutTasks.delete(task);
  };
}
/** Await subscribers before publishing a new company to rendered state. */
export async function emitSessionEvent(event: SessionEvent): Promise<void> {
  await Promise.allSettled(
    [...(handlers.get(event.type) ?? [])].map(async (handler) => {
      await handler(event);
    }),
  );
}
/** Every registered cleanup task receives a chance to clear its own data. */
export async function runSignOutTasks(): Promise<void> {
  await Promise.allSettled(
    [...signOutTasks].map(async (task) => {
      await task();
    }),
  );
}
