import {
  randomBytes,
  randomUUID,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import type { Claims, Client, IdentityProvider, Tokens } from "./ports";
import { maskEmail, Refusal } from "./problems";
const scrypt = promisify(scryptCallback);
interface User {
  claims: Claims;
  salt: Buffer;
  hash: Buffer;
  codeExpiresAt: number;
}
export function createLocalIdentityProvider(options: {
  confirmationCode: string;
  clock?: () => Date;
}): IdentityProvider {
  if (!/^\d{6}$/.test(options.confirmationCode))
    throw new Error("LOCAL_IDENTITY_CONFIRMATION_CODE must contain six digits");
  const clock = options.clock ?? (() => new Date());
  const users = new Map<string, User>();
  const access = new Map<string, { user: User; expires: number }>();
  const refresh = new Map<string, { user: User; client: Client }>();
  function user(email: string): User {
    const found = users.get(email);
    if (!found) throw new Refusal("INVALID_CREDENTIALS");
    return found;
  }
  function issue(found: User, client: Client, existing?: string): Tokens {
    const accessToken = randomBytes(32).toString("base64url");
    const refreshToken = existing ?? randomBytes(32).toString("base64url");
    const expires = clock().getTime() + 3600_000;
    access.set(accessToken, { user: found, expires });
    refresh.set(refreshToken, { user: found, client });
    return {
      accessToken,
      refreshToken,
      accessTokenExpiresAt: new Date(expires).toISOString(),
    };
  }
  return {
    async signUp(input) {
      if (users.has(input.email)) throw new Refusal("EMAIL_TAKEN");
      if (
        input.password.length < 12 ||
        !/[a-z]/.test(input.password) ||
        !/[A-Z]/.test(input.password) ||
        !/\d/.test(input.password) ||
        !/[^A-Za-z0-9\s]/.test(input.password)
      )
        throw new Refusal("PASSWORD_POLICY");
      const salt = randomBytes(16);
      const hash = await scrypt(input.password, salt, 64);
      const subject = randomUUID();
      if (users.has(input.email)) throw new Refusal("EMAIL_TAKEN");
      users.set(input.email, {
        claims: {
          subject,
          email: input.email,
          emailVerified: false,
          displayName: input.fullName,
          locale: input.locale,
        },
        salt,
        hash: hash as Buffer,
        codeExpiresAt: clock().getTime() + 1800_000,
      });
      return { accountId: subject, destination: maskEmail(input.email) };
    },
    confirmSignUp(input) {
      const found = user(input.email);
      if (clock().getTime() > found.codeExpiresAt)
        return Promise.reject(new Refusal("CODE_EXPIRED"));
      if (input.code !== options.confirmationCode)
        return Promise.reject(new Refusal("CODE_MISMATCH"));
      found.claims.emailVerified = true;
      return Promise.resolve();
    },
    resendCode(email) {
      user(email).codeExpiresAt = clock().getTime() + 1800_000;
      return Promise.resolve();
    },
    async signInWithPassword(input) {
      const found = user(input.username);
      const hash = await scrypt(input.password, found.salt, 64);
      if (!timingSafeEqual(hash as Buffer, found.hash))
        throw new Refusal("INVALID_CREDENTIALS");
      if (!found.claims.emailVerified) throw new Refusal("USER_NOT_CONFIRMED");
      return {
        claims: { ...found.claims },
        tokens: issue(found, input.client),
      };
    },
    refresh(token, client) {
      const found = refresh.get(token);
      if (found?.client !== client)
        return Promise.reject(new Refusal("SESSION_INVALID"));
      return Promise.resolve(issue(found.user, client, token));
    },
    revokeRefreshToken(token, client) {
      const found = refresh.get(token);
      if (found?.client === client) refresh.delete(token);
      return Promise.resolve();
    },
    verifyAccessToken(token) {
      const found = access.get(token);
      if (!found || found.expires <= clock().getTime())
        return Promise.reject(new Refusal("SESSION_INVALID"));
      return Promise.resolve({ ...found.user.claims });
    },
    getUserClaims(username) {
      const found =
        users.get(username) ??
        [...users.values()].find((entry) => entry.claims.subject === username);
      return found
        ? Promise.resolve({ ...found.claims })
        : Promise.reject(new Refusal("INVALID_CREDENTIALS"));
    },
  };
}
