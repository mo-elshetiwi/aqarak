import { createRef } from "react";
import { authError, AuthError, type AuthClient } from "./auth-client";
import type { Credentials, Me, RefreshTokens } from "./contract";
import {
  sessionReducer,
  type SessionAction,
  type SessionState,
} from "./session";
import type { TokenStore } from "./token-store";
import { emitSessionEvent, runSignOutTasks } from "./session-events";
/** Injectable transport and storage keep session tests independent of network and devices. */
export interface SessionOptions {
  client: AuthClient;
  store: TokenStore;
  clock?: () => number;
  schedule?: (task: () => void, delay: number) => () => void;
}
/** Credentials remain in a private ref; subscribers receive only the pure reducer state. */
export class SessionController {
  private state: SessionState = { status: "restoring" };
  private readonly accessToken = createRef<string | null>();
  private readonly listeners = new Set<() => void>();
  private generation = 0;
  private requestVersion = 0;
  private signInFlight: Promise<void> | null = null;
  private restoreFlight: Promise<void> | null = null;
  private signOutFlight: Promise<void> | null = null;
  private refreshFlight: Promise<string> | null = null;
  private switchQueue: Promise<void> = Promise.resolve();
  private renewalActive = false;
  private cancelRenewal: (() => void) | null = null;
  constructor(private readonly options: SessionOptions) {}
  /** Stable snapshot identity supports React's external-store subscription. */
  getSnapshot = (): SessionState => this.state;
  /** A subscription never exposes bearer credentials. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private dispatch(action: SessionAction): void {
    this.state = sessionReducer(this.state, action);
    this.armRenewal();
    for (const listener of this.listeners) listener();
  }
  /** Lifecycle owners cancel scheduling when the provider unmounts. */
  startRenewal = (): (() => void) => {
    this.renewalActive = true;
    this.armRenewal();
    return () => {
      this.renewalActive = false;
      this.cancelRenewal?.();
      this.cancelRenewal = null;
    };
  };
  private armRenewal(retryDelay?: number): void {
    this.cancelRenewal?.();
    this.cancelRenewal = null;
    if (!this.renewalActive || this.state.status !== "signed_in") return;
    const delay =
      retryDelay ??
      Math.max(
        0,
        Date.parse(this.state.accessTokenExpiresAt) -
          60_000 -
          (this.options.clock ?? Date.now)(),
      );
    const task = (): void => {
      this.cancelRenewal = null;
      void this.renew().catch(() => {
        this.armRenewal(30_000);
      });
    };
    if (this.options.schedule)
      this.cancelRenewal = this.options.schedule(task, delay);
    else {
      const timer = setTimeout(task, delay);
      this.cancelRenewal = () => {
        clearTimeout(timer);
      };
    }
  }
  /** Bearer credentials are read only at the request boundary, never from rendered state. */
  getAccessToken = (): string => {
    if (this.state.status !== "signed_in" || !this.accessToken.current)
      throw new AuthError("session_ended");
    return this.accessToken.current;
  };
  /** Responses from an earlier account or company must never enter the current scope. */
  getRequestVersion = (): number => this.requestVersion;
  /** A late 401 reuses an already renewed token instead of rotating it twice. */
  refreshAfterUnauthorized = (rejectedToken: string): Promise<string> => {
    const current = this.getAccessToken();
    return current !== rejectedToken ? Promise.resolve(current) : this.renew();
  };
  /** Scheduled, foreground and request-triggered renewal share one operation. */
  renew = (): Promise<string> => {
    if (this.refreshFlight) return this.refreshFlight;
    this.refreshFlight = this.renewOnce().finally(() => {
      this.refreshFlight = null;
    });
    return this.refreshFlight;
  };
  private async renewOnce(): Promise<string> {
    const version = this.generation;
    this.getAccessToken();
    try {
      const refresh = await this.options.store.getRefreshToken();
      if (!refresh || version !== this.generation)
        throw new AuthError("session_ended");
      const tokens = await this.options.client.refresh(refresh);
      if (version !== this.generation) throw new AuthError("session_ended");
      if (tokens.refreshToken)
        await this.options.store.setRefreshToken(tokens.refreshToken);
      if (version !== this.generation) throw new AuthError("session_ended");
      this.accessToken.current = tokens.accessToken;
      this.dispatch({
        type: "renewed",
        accessTokenExpiresAt: tokens.accessTokenExpiresAt,
      });
      // A server returning a short lifetime must not cause a tight refresh loop.
      if (
        Date.parse(tokens.accessTokenExpiresAt) <=
        (this.options.clock ?? Date.now)() + 60_000
      )
        this.armRenewal(30_000);
      return tokens.accessToken;
    } catch (error) {
      if (
        version === this.generation &&
        authError(error).code === "session_ended"
      )
        await this.signOut("session_ended");
      throw authError(error);
    }
  }
  private async accept(
    tokens: RefreshTokens,
    me: Me,
    version: number,
  ): Promise<void> {
    if (version !== this.generation) return;
    if (tokens.refreshToken)
      await this.options.store.setRefreshToken(tokens.refreshToken);
    const stored = await this.options.store.getActiveCompanyId();
    if (version !== this.generation) return;
    const companyId =
      me.contexts.find((context) => context.companyId === stored)?.companyId ??
      me.contexts[0]?.companyId ??
      null;
    if (companyId) await this.options.store.setActiveCompanyId(companyId);
    if (version !== this.generation) return;
    this.accessToken.current = tokens.accessToken;
    this.dispatch({
      type: "signed_in",
      me,
      activeCompanyId: companyId,
      accessTokenExpiresAt: tokens.accessTokenExpiresAt,
    });
  }
  /** Restore failures retain the refresh credential for a deliberate retry. */
  restore = (): Promise<void> => {
    if (this.restoreFlight) return this.restoreFlight;
    this.restoreFlight = this.restoreOnce().finally(() => {
      this.restoreFlight = null;
    });
    return this.restoreFlight;
  };
  private async restoreOnce(): Promise<void> {
    const version = this.generation;
    this.dispatch({ type: "restore" });
    try {
      const refresh = await this.options.store.getRefreshToken();
      if (version !== this.generation) return;
      if (!refresh) {
        this.dispatch({ type: "signed_out" });
        return;
      }
      const tokens = await this.options.client.refresh(refresh);
      if (version !== this.generation) return;
      if (tokens.refreshToken)
        await this.options.store.setRefreshToken(tokens.refreshToken);
      const me = await this.options.client.getMe(tokens.accessToken);
      await this.accept({ ...tokens, refreshToken: undefined }, me, version);
    } catch (error) {
      if (version !== this.generation) return;
      if (authError(error).code === "session_ended")
        await this.signOut("session_ended");
      else this.dispatch({ type: "restore_failed" });
    }
  }
  /** Duplicate callers share one sign-in operation. */
  signIn = (credentials: Credentials): Promise<void> => {
    if (this.signInFlight) return this.signInFlight;
    this.signInFlight = this.signInOnce(credentials).finally(() => {
      this.signInFlight = null;
    });
    return this.signInFlight;
  };
  private async signInOnce(credentials: Credentials): Promise<void> {
    await this.signOutFlight;
    const version = ++this.generation;
    this.requestVersion += 1;
    const tokens = await this.options.client.signIn(credentials);
    const me = await this.options.client.getMe(tokens.accessToken);
    await this.accept(tokens, me, version);
  }
  /** Local cleanup and navigation never wait for the sign-out endpoint. */
  signOut = (reason?: "session_ended"): Promise<void> => {
    if (this.signOutFlight) return this.signOutFlight;
    this.signOutFlight = this.signOutOnce(reason).finally(() => {
      this.signOutFlight = null;
    });
    return this.signOutFlight;
  };
  private async signOutOnce(reason?: "session_ended"): Promise<void> {
    const previous = this.state;
    this.generation += 1;
    this.requestVersion += 1;
    this.cancelRenewal?.();
    this.cancelRenewal = null;
    const access = this.accessToken.current;
    this.accessToken.current = null;
    const refresh = await this.options.store
      .getRefreshToken()
      .catch(() => null);
    if (access && refresh)
      void this.options.client.signOut(access, refresh).catch(() => undefined);
    try {
      await this.options.store.deleteSessionKeys();
    } finally {
      await runSignOutTasks();
      await emitSessionEvent({
        type: "signed_out",
        accountId: previous.status === "signed_in" ? previous.account.id : null,
        previousCompanyId:
          previous.status === "signed_in" ? previous.activeCompanyId : null,
        companyId: null,
      });
      this.dispatch(
        reason ? { type: "signed_out", reason } : { type: "signed_out" },
      );
    }
  }
  /** Company changes clear subscribers before publishing their persisted context. */
  switchContext = (companyId: string): Promise<void> => {
    const version = this.generation;
    const next = this.switchQueue.then(() =>
      this.switchContextOnce(companyId, version),
    );
    this.switchQueue = next.catch(() => undefined);
    return next;
  };
  private async switchContextOnce(
    companyId: string,
    version: number,
  ): Promise<void> {
    const previous = this.state;
    if (version !== this.generation || previous.status !== "signed_in")
      throw new AuthError("session_ended");
    if (!previous.contexts.some((context) => context.companyId === companyId))
      throw new AuthError("unexpected_response");
    if (previous.activeCompanyId === companyId) return;
    this.requestVersion += 1;
    await emitSessionEvent({
      type: "context_changed",
      accountId: previous.account.id,
      previousCompanyId: previous.activeCompanyId,
      companyId,
    });
    if (version !== this.generation) return;
    await this.options.store.setActiveCompanyId(companyId);
    if (version !== this.generation) return;
    // Requests started during cleanup still belong to the previous company.
    this.requestVersion += 1;
    this.dispatch({ type: "context_changed", companyId });
  }
  /** Future query keys begin with this account and company boundary. */
  queryScope = (): readonly [string, string] => {
    if (this.state.status !== "signed_in" || !this.state.activeCompanyId)
      throw new AuthError("session_ended");
    return [this.state.account.id, this.state.activeCompanyId];
  };
}
