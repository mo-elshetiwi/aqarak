import { z } from "zod";
import type { DataApiExecutor } from "@aqarak/db/data-api";
export const claimsSchema = z.object({
  subject: z.guid(),
  email: z.email().transform((value) => value.toLowerCase()),
  emailVerified: z.boolean(),
  displayName: z.string().min(1),
  locale: z.enum(["en", "ar"]),
});
export type Claims = z.infer<typeof claimsSchema>;
export type Client = "web" | "mobile";
export interface SignUpInput {
  email: string;
  password: string;
  fullName: string;
  locale: "en" | "ar";
}
export interface Tokens {
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
}
export interface IdentityProvider {
  signUp(
    input: SignUpInput,
  ): Promise<{ accountId: string; destination: string }>;
  confirmSignUp(input: { email: string; code: string }): Promise<void>;
  resendCode(email: string): Promise<void>;
  signInWithPassword(input: {
    username: string;
    password: string;
    client: Client;
  }): Promise<{ claims: Claims; tokens: Tokens }>;
  refresh(refreshToken: string, client: Client): Promise<Tokens>;
  revokeRefreshToken(refreshToken: string, client: Client): Promise<void>;
  verifyAccessToken(token: string): Promise<Claims>;
  getUserClaims(username: string): Promise<Claims>;
}
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}
export interface EmailSender {
  send(message: EmailMessage): Promise<"sent" | "not_configured">;
}
export interface Dependencies {
  executor: DataApiExecutor;
  identityProvider: IdentityProvider;
  emailSender: EmailSender;
  clock: () => Date;
  appOrigin: string;
}
export type DependencySource = Dependencies | (() => Dependencies);
export function dependencies(source: DependencySource): Dependencies {
  return typeof source === "function" ? source() : source;
}
