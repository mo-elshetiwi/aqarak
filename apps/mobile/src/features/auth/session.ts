import type { Me } from "./contract";
/** Rendered state deliberately excludes access and refresh credentials. */
export type SessionState =
  | { status: "restoring" }
  | { status: "restore_failed" }
  | { status: "signed_out"; reason?: "session_ended" }
  | ({
      status: "signed_in";
      activeCompanyId: string | null;
      accessTokenExpiresAt: string;
    } & Me);
/** Explicit transitions keep side effects outside the reducer. */
export type SessionAction =
  | { type: "restore" }
  | { type: "restore_failed" }
  | { type: "signed_out"; reason?: "session_ended" }
  | {
      type: "signed_in";
      me: Me;
      activeCompanyId: string | null;
      accessTokenExpiresAt: string;
    }
  | { type: "context_changed"; companyId: string }
  | { type: "renewed"; accessTokenExpiresAt: string };
/** Exhaustive transitions preserve a predictable navigation boundary. */
export function sessionReducer(
  state: SessionState,
  action: SessionAction,
): SessionState {
  switch (action.type) {
    case "restore":
      return { status: "restoring" };
    case "restore_failed":
      return { status: "restore_failed" };
    case "signed_out":
      return action.reason
        ? { status: "signed_out", reason: action.reason }
        : { status: "signed_out" };
    case "signed_in":
      return {
        status: "signed_in",
        ...action.me,
        activeCompanyId: action.activeCompanyId,
        accessTokenExpiresAt: action.accessTokenExpiresAt,
      };
    case "context_changed":
      return state.status === "signed_in"
        ? { ...state, activeCompanyId: action.companyId }
        : state;
    case "renewed":
      return state.status === "signed_in"
        ? { ...state, accessTokenExpiresAt: action.accessTokenExpiresAt }
        : state;
  }
}
