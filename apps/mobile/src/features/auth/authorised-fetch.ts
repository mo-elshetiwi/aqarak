import { AuthError } from "./auth-client";
import type { SessionController } from "./session-controller";
/** Replays one request after renewal while rejecting responses across identity boundaries. */
export function createAuthorisedFetch(
  session: SessionController,
  fetcher: typeof fetch = fetch,
): typeof fetch {
  return async (input, init) => {
    const version = session.getRequestVersion();
    const token = session.getAccessToken();
    const request = new Request(
      input instanceof URL ? input.href : input,
      init,
    );
    function checkScope(): void {
      if (session.getRequestVersion() !== version)
        throw new AuthError("session_ended");
    }
    function send(access: string): Promise<Response> {
      const copy = request.clone();
      copy.headers.set("Authorization", `Bearer ${access}`);
      return fetcher(copy);
    }
    let response = await send(token);
    checkScope();
    if (response.status === 401) {
      const renewed = await session.refreshAfterUnauthorized(token);
      checkScope();
      response = await send(renewed);
      checkScope();
      if (response.status === 401) {
        await session.signOut("session_ended");
        throw new AuthError("session_ended");
      }
    }
    return response;
  };
}
