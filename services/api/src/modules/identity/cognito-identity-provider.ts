import {
  AdminGetUserCommand,
  AdminInitiateAuthCommand,
  ConfirmSignUpCommand,
  ResendConfirmationCodeCommand,
  RevokeTokenCommand,
  SignUpCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { CognitoJwtVerifier } from "aws-jwt-verify";
import { z } from "zod";
import {
  claimsSchema,
  type Claims,
  type Client,
  type IdentityProvider,
  type Tokens,
} from "./ports";
import { maskEmail, Refusal, type ProblemCode } from "./problems";

type Command =
  | AdminGetUserCommand
  | AdminInitiateAuthCommand
  | ConfirmSignUpCommand
  | ResendConfirmationCodeCommand
  | RevokeTokenCommand
  | SignUpCommand;
export interface CognitoOptions {
  poolId: string;
  webClientId: string;
  mobileClientId: string;
  send: (command: Command) => Promise<unknown>;
  verify?: (token: string) => Promise<{ sub: string }>;
  clock?: () => Date;
}
const exceptions: Readonly<Record<string, ProblemCode>> = {
  UsernameExistsException: "EMAIL_TAKEN",
  InvalidPasswordException: "PASSWORD_POLICY",
  CodeMismatchException: "CODE_MISMATCH",
  ExpiredCodeException: "CODE_EXPIRED",
  NotAuthorizedException: "INVALID_CREDENTIALS",
  UserNotFoundException: "INVALID_CREDENTIALS",
  UserNotConfirmedException: "USER_NOT_CONFIRMED",
  LimitExceededException: "RATE_LIMITED",
  TooManyRequestsException: "RATE_LIMITED",
  TooManyFailedAttemptsException: "RATE_LIMITED",
  InvalidParameterException: "VALIDATION_FAILED",
};
export function providerFailure(error: unknown): Refusal {
  return error instanceof Refusal
    ? error
    : new Refusal(
        exceptions[error instanceof Error ? error.name : ""] ?? "UNAVAILABLE",
      );
}
const attributesSchema = z.array(
  z.object({ Name: z.string(), Value: z.string() }),
);
function claimsFromAttributes(
  subject: string,
  attributes: z.infer<typeof attributesSchema>,
): Claims {
  const values = Object.fromEntries(
    attributes.map(({ Name, Value }) => [Name, Value]),
  );
  return claimsSchema.parse({
    subject: values.sub ?? subject,
    email: values.email,
    emailVerified: values.email_verified === "true",
    displayName: values.name,
    locale: values.locale,
  });
}
function idClaims(token: string): Claims {
  const encoded = token.split(".")[1];
  if (!encoded) throw new Refusal("UNAVAILABLE");
  const data = z
    .object({
      sub: z.string(),
      email: z.string(),
      email_verified: z.boolean(),
      name: z.string(),
      locale: z.string(),
    })
    .parse(JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")));
  return claimsSchema.parse({
    subject: data.sub,
    email: data.email,
    emailVerified: data.email_verified,
    displayName: data.name,
    locale: data.locale,
  });
}
const authentication = z.object({
  ChallengeName: z.string().optional(),
  AuthenticationResult: z
    .object({
      AccessToken: z.string(),
      IdToken: z.string().optional(),
      RefreshToken: z.string().optional(),
      ExpiresIn: z.number(),
    })
    .optional(),
});
export function createCognitoIdentityProvider(
  options: CognitoOptions,
): IdentityProvider {
  const clientId = (client: Client): string =>
    client === "web" ? options.webClientId : options.mobileClientId;
  const jwtVerifier = CognitoJwtVerifier.create({
    userPoolId: options.poolId,
    tokenUse: "access",
    clientId: [options.webClientId, options.mobileClientId],
  });
  const verifier =
    options.verify ?? ((token: string) => jwtVerifier.verify(token));
  async function send(command: Command): Promise<unknown> {
    try {
      return await options.send(command);
    } catch (error) {
      throw providerFailure(error);
    }
  }
  function result(
    value: unknown,
    refreshToken?: string,
  ): { tokens: Tokens; idToken: string | undefined } {
    const data = authentication.parse(value);
    if (data.ChallengeName) throw new Refusal("FORBIDDEN");
    const auth = data.AuthenticationResult;
    if (!auth || !(auth.RefreshToken ?? refreshToken))
      throw new Refusal("UNAVAILABLE");
    return {
      tokens: {
        accessToken: auth.AccessToken,
        refreshToken: auth.RefreshToken ?? refreshToken ?? "",
        accessTokenExpiresAt: new Date(
          (options.clock?.() ?? new Date()).getTime() + auth.ExpiresIn * 1000,
        ).toISOString(),
      },
      idToken: auth.IdToken,
    };
  }
  async function getUserClaims(username: string): Promise<Claims> {
    const data = z
      .object({ Username: z.string(), UserAttributes: attributesSchema })
      .parse(
        await send(
          new AdminGetUserCommand({
            UserPoolId: options.poolId,
            Username: username,
          }),
        ),
      );
    return claimsFromAttributes(data.Username, data.UserAttributes);
  }
  return {
    async signUp(input) {
      const data = z.object({ UserSub: z.guid() }).parse(
        await send(
          new SignUpCommand({
            ClientId: options.webClientId,
            Username: input.email,
            Password: input.password,
            UserAttributes: [
              { Name: "email", Value: input.email },
              { Name: "name", Value: input.fullName },
              { Name: "locale", Value: input.locale },
            ],
          }),
        ),
      );
      return { accountId: data.UserSub, destination: maskEmail(input.email) };
    },
    async confirmSignUp(input) {
      await send(
        new ConfirmSignUpCommand({
          ClientId: options.webClientId,
          Username: input.email,
          ConfirmationCode: input.code,
        }),
      );
    },
    async resendCode(email) {
      await send(
        new ResendConfirmationCodeCommand({
          ClientId: options.webClientId,
          Username: email,
        }),
      );
    },
    async signInWithPassword(input) {
      const data = result(
        await send(
          new AdminInitiateAuthCommand({
            UserPoolId: options.poolId,
            ClientId: clientId(input.client),
            AuthFlow: "ADMIN_USER_PASSWORD_AUTH",
            AuthParameters: {
              USERNAME: input.username,
              PASSWORD: input.password,
            },
          }),
        ),
      );
      if (!data.idToken) throw new Refusal("UNAVAILABLE");
      return { claims: idClaims(data.idToken), tokens: data.tokens };
    },
    async refresh(refreshToken, client) {
      return result(
        await send(
          new AdminInitiateAuthCommand({
            UserPoolId: options.poolId,
            ClientId: clientId(client),
            AuthFlow: "REFRESH_TOKEN_AUTH",
            AuthParameters: { REFRESH_TOKEN: refreshToken },
          }),
        ),
        refreshToken,
      ).tokens;
    },
    async revokeRefreshToken(refreshToken, client) {
      await send(
        new RevokeTokenCommand({
          ClientId: clientId(client),
          Token: refreshToken,
        }),
      );
    },
    async verifyAccessToken(token) {
      try {
        const verified = await verifier(token);
        return await getUserClaims(verified.sub);
      } catch {
        throw new Refusal("SESSION_INVALID");
      }
    },
    getUserClaims,
  };
}
