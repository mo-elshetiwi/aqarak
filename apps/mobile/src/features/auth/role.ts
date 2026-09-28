import type { Capacity } from "./contract";
/** Only these capacities currently have a mobile navigation surface. */
export type MobileRole = "manager" | "technician" | "owner" | "tenant";
/** Precedence selects navigation only; the server authorises every request. */
export function resolveMobileRole(
  capacities: readonly Capacity[],
): MobileRole | null {
  for (const role of ["manager", "technician", "owner", "tenant"] as const)
    if (capacities.includes(role)) return role;
  return null;
}
/** Fixed tab order is shared by each real route layout. */
export const roleTabs = {
  manager: ["home", "inbox", "records", "maintenance", "co-worker"],
  owner: ["home", "inbox", "portfolio", "statements", "co-worker"],
  tenant: ["home", "inbox", "payments", "maintenance", "co-worker"],
  technician: ["jobs", "inbox", "co-worker"],
} as const;
/** Tab names also identify catalogue keys and stable test targets. */
export type TabName = (typeof roleTabs)[MobileRole][number];
/** Each role has a unique initial pathname. */
export function roleHome(
  role: MobileRole | null,
):
  | "/manager/home"
  | "/owner/home"
  | "/tenant/home"
  | "/technician/jobs"
  | "/no-mobile-role" {
  switch (role) {
    case "manager":
      return "/manager/home";
    case "owner":
      return "/owner/home";
    case "tenant":
      return "/tenant/home";
    case "technician":
      return "/technician/jobs";
    case null:
      return "/no-mobile-role";
  }
}
