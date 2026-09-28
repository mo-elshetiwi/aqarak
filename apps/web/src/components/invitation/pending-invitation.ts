import { z } from "zod";
import { invitationTokenSchema, localeSchema } from "@/lib/api/contract";
const pendingSchema = z.object({
  token: invitationTokenSchema,
  locale: localeSchema,
});
export const PENDING_INVITATION_KEY = "aqarak.pendingInvitation";
/** Reads only this tab's validated invitation, never placing it in navigation. */
export function readPendingInvitation(
  locale: string,
): z.infer<typeof pendingSchema> | null {
  try {
    const stored = sessionStorage.getItem(PENDING_INVITATION_KEY);
    const parsed = pendingSchema.safeParse(stored ? JSON.parse(stored) : null);
    return parsed.success && parsed.data.locale === locale ? parsed.data : null;
  } catch {
    return null;
  }
}
/** Removes the fragment before previewing or leaving the invitation page. */
export function capturePendingInvitation(locale: string): {
  token: string | null;
  storageUnavailable: boolean;
} {
  const fragment = window.location.hash.slice(1);
  if (!fragment)
    return {
      token: readPendingInvitation(locale)?.token ?? null,
      storageUnavailable: false,
    };
  window.history.replaceState(
    window.history.state,
    "",
    window.location.pathname + window.location.search,
  );
  const parsed = pendingSchema.safeParse({ token: fragment, locale });
  try {
    sessionStorage.removeItem(PENDING_INVITATION_KEY);
    if (!parsed.success) return { token: null, storageUnavailable: false };
    sessionStorage.setItem(PENDING_INVITATION_KEY, JSON.stringify(parsed.data));
    return { token: parsed.data.token, storageUnavailable: false };
  } catch {
    return { token: null, storageUnavailable: true };
  }
}
export function clearPendingInvitation(): void {
  try {
    sessionStorage.removeItem(PENDING_INVITATION_KEY);
  } catch {
    /* Storage may be disabled after the page was loaded. */
  }
}
