import { randomBytes } from "node:crypto";
import { Hono } from "hono";
import { z } from "zod";
import {
  accountTx,
  recordSecurity,
  rows,
  securityEvent,
  sha256,
} from "./database";
import {
  authenticate,
  boundary,
  type IdentityVariables,
  type Principal,
} from "./guard";
import { body, Refusal } from "./problems";
import {
  dependencies,
  type Dependencies,
  type DependencySource,
} from "./ports";
import { getMe } from "./accounts";
import * as schema from "./schemas";
async function signIn(
  deps: Dependencies,
  input: z.infer<typeof schema.signIn>,
): Promise<unknown> {
  const username = input.client === "web" ? input.email : input.username;
  let grant;
  try {
    grant = await deps.identityProvider.signInWithPassword({
      username,
      password: input.password,
      client: input.client,
    });
  } catch (error) {
    if (error instanceof Refusal && error.code !== "UNAVAILABLE")
      await recordSecurity(deps, {
        type: "sign_in_refused",
        client: input.client,
        email: username,
      });
    throw error;
  }
  if (!grant.claims.emailVerified) {
    await recordSecurity(deps, {
      type: "sign_in_refused",
      client: input.client,
      email: username,
    });
    throw new Refusal("USER_NOT_CONFIRMED");
  }
  const accountId = grant.claims.subject;
  if (input.client === "mobile") {
    await recordSecurity(deps, {
      accountId,
      type: "sign_in",
      client: "mobile",
    });
    return grant.tokens;
  }
  const id = randomBytes(32).toString("base64url");
  const now = deps.clock();
  const expiresAt = new Date(now.getTime() + 7 * 86400_000).toISOString();
  const idleExpiresAt = new Date(now.getTime() + 8 * 3600_000).toISOString();
  await accountTx(deps, accountId, async (tx) => {
    const session = await rows(
      tx,
      `insert into ops.auth_session(account_id,auth_subject,client,session_hash,email,display_name,locale,created_at,last_seen_at,idle_expires_at,expires_at)
      values(cast(:account as uuid),:account,'web',:hash,:email,:name,:locale,cast(:now as timestamptz),cast(:now as timestamptz),cast(:idle as timestamptz),cast(:expires as timestamptz)) returning id`,
      {
        account: accountId,
        hash: sha256(id),
        email: grant.claims.email,
        name: grant.claims.displayName,
        locale: grant.claims.locale,
        now: now.toISOString(),
        idle: idleExpiresAt,
        expires: expiresAt,
      },
    );
    await securityEvent(tx, {
      accountId,
      type: "sign_in",
      client: "web",
      sessionId: String(session[0]?.id),
    });
  });
  try {
    await deps.identityProvider.revokeRefreshToken(
      grant.tokens.refreshToken,
      "web",
    );
  } catch {
    await recordSecurity(deps, {
      accountId,
      type: "token_revoke_failed",
      client: "web",
    });
  }
  return { session: { id, expiresAt, idleExpiresAt } };
}
async function signOut(
  deps: Dependencies,
  principal: Principal,
  refreshToken?: string,
): Promise<void> {
  if (principal.client === "mobile") {
    if (!refreshToken) throw new Refusal("VALIDATION_FAILED");
    await deps.identityProvider.revokeRefreshToken(refreshToken, "mobile");
  }
  await accountTx(deps, principal.accountId, async (tx) => {
    if (principal.sessionId)
      await rows(
        tx,
        "update ops.auth_session set revoked_at=cast(:now as timestamptz),revoke_reason='sign_out' where id=cast(:id as uuid) and revoked_at is null",
        { id: principal.sessionId, now: deps.clock().toISOString() },
      );
    await securityEvent(tx, {
      accountId: principal.accountId,
      type: "sign_out",
      client: principal.client,
      sessionId: principal.sessionId,
    });
  });
}
export function authRoutes(
  source: DependencySource,
): Hono<{ Variables: IdentityVariables }> {
  const routes = new Hono<{ Variables: IdentityVariables }>();
  routes.post("/auth/sign-up", (c) =>
    boundary(c, async () => {
      const input = await body(c, schema.signUp);
      const deps = dependencies(source);
      const result = await deps.identityProvider.signUp(input);
      await recordSecurity(deps, {
        accountId: result.accountId,
        type: "sign_up",
        client: "web",
      });
      return c.json(
        {
          accountId: result.accountId,
          delivery: { medium: "email", destination: result.destination },
        },
        201,
      );
    }),
  );
  routes.post("/auth/confirm-sign-up", (c) =>
    boundary(c, async () => {
      const input = await body(
        c,
        z.object({ email: schema.email, code: z.string().regex(/^\d{6}$/) }),
      );
      const deps = dependencies(source);
      await deps.identityProvider.confirmSignUp(input);
      const claims = await deps.identityProvider.getUserClaims(input.email);
      await recordSecurity(deps, {
        accountId: claims.subject,
        type: "sign_up_confirmed",
        client: "web",
      });
      return c.body(null, 204);
    }),
  );
  routes.post("/auth/resend-code", (c) =>
    boundary(c, async () => {
      const input = await body(c, z.object({ email: schema.email }));
      await dependencies(source).identityProvider.resendCode(input.email);
      return c.body(null, 204);
    }),
  );
  routes.post("/auth/sign-in", (c) =>
    boundary(c, async () => {
      const input = await body(c, schema.signIn);
      return c.json(await signIn(dependencies(source), input));
    }),
  );
  routes.post("/auth/refresh", (c) =>
    boundary(c, async () => {
      const input = await body(
        c,
        z.object({
          refreshToken: z.string().min(1).max(8192),
          client: z.literal("mobile"),
        }),
      );
      const deps = dependencies(source);
      let tokens;
      try {
        tokens = await deps.identityProvider.refresh(
          input.refreshToken,
          "mobile",
        );
      } catch {
        throw new Refusal("SESSION_INVALID");
      }
      const claims = await deps.identityProvider.verifyAccessToken(
        tokens.accessToken,
      );
      await recordSecurity(deps, {
        accountId: claims.subject,
        type: "token_refreshed",
        client: "mobile",
      });
      return c.json({
        accessToken: tokens.accessToken,
        accessTokenExpiresAt: tokens.accessTokenExpiresAt,
        ...(tokens.refreshToken !== input.refreshToken
          ? { refreshToken: tokens.refreshToken }
          : {}),
      });
    }),
  );
  routes.post("/auth/sign-out", authenticate(source), (c) =>
    boundary(c, async () => {
      const principal = c.get("principal");
      const input =
        principal.client === "mobile"
          ? await body(
              c,
              z.object({ refreshToken: z.string().min(1).max(8192) }),
            )
          : undefined;
      await signOut(dependencies(source), principal, input?.refreshToken);
      return c.body(null, 204);
    }),
  );
  routes.get("/me", authenticate(source), (c) =>
    boundary(c, async () =>
      c.json(await getMe(dependencies(source), c.get("principal"))),
    ),
  );
  return routes;
}
