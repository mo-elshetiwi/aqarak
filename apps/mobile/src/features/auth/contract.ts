import { z } from "zod";
/** These local schemas define the contract until a generated API client exists. */
export const capacitySchema = z.enum([
  "manager",
  "technician",
  "company_administrator",
  "accountant",
  "owner",
  "tenant",
]);
/** Contexts bind capacities to one company rather than treating navigation as authorisation. */
export const contextSchema = z.strictObject({
  companyId: z.uuid(),
  companyName: z.strictObject({ en: z.string().min(1), ar: z.string().min(1) }),
  isDemo: z.boolean(),
  capacities: z.array(capacitySchema),
});
/** Account and context data are validated at every transport boundary. */
export const meSchema = z.strictObject({
  account: z.strictObject({
    id: z.guid(),
    displayName: z.string().min(1),
    locale: z.enum(["en", "ar"]),
  }),
  contexts: z.array(contextSchema),
});
/** Sign-in always returns a refresh credential for secure storage. */
export const signInSchema = z.strictObject({
  accessToken: z.string().min(1),
  accessTokenExpiresAt: z.iso.datetime(),
  refreshToken: z.string().min(1),
});
/** Refresh may rotate the refresh credential. */
export const refreshSchema = signInSchema.extend({
  refreshToken: z.string().min(1).optional(),
});
/** Input bounds mirror the server contract and permit password managers. */
export const credentialsSchema = z.strictObject({
  username: z.string().min(1).max(128),
  password: z.string().min(1).max(256),
});
/** Stable transport-independent failures support catalogue keys. */
export const authErrorCodeSchema = z.enum([
  "invalid_credentials",
  "too_many_attempts",
  "session_ended",
  "network_unavailable",
  "service_unavailable",
  "unexpected_response",
]);
/** Problem details permit RFC 9457 extension members owned by the server. */
export const problemSchema = z.looseObject({
  type: z.string().optional(),
  title: z.string().optional(),
  status: z.number().int().min(100).max(599).optional(),
  detail: z.string().optional(),
  instance: z.string().optional(),
  code: z.string().min(1),
});
/** A successful sign-out has no response body. */
export const signOutSchema = z.literal("").transform(() => undefined);
/** Validated account response. */
export type Me = z.infer<typeof meSchema>;
/** Validated company context. */
export type CompanyContext = z.infer<typeof contextSchema>;
/** Capacity vocabulary is shared by navigation and transport. */
export type Capacity = z.infer<typeof capacitySchema>;
/** Sign-in credentials are never persisted. */
export type Credentials = z.infer<typeof credentialsSchema>;
/** Fresh token response. */
export type SignInTokens = z.infer<typeof signInSchema>;
/** Optional refresh rotation response. */
export type RefreshTokens = z.infer<typeof refreshSchema>;
/** Catalogue-compatible failure codes. */
export type AuthErrorCode = z.infer<typeof authErrorCodeSchema>;
