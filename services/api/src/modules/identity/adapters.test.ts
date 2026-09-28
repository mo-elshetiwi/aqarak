import { readFile } from "node:fs/promises";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import {
  createCognitoIdentityProvider,
  providerFailure,
  type CognitoOptions,
} from "./cognito-identity-provider";
import { createLocalIdentityProvider } from "./local-identity-provider";
import {
  createDisabledEmailSender,
  createSesEmailSender,
} from "./email-sender";
import {
  maskEmail,
  problem,
  problemStatuses,
  type ProblemCode,
} from "./problems";
import { companyCreationId } from "./database";
const subject = "11111111-1111-7111-f111-111111111111";
const claims = {
  sub: subject,
  email: "layla@example.com",
  email_verified: true,
  name: "Layla",
  locale: "en",
};
const idToken = `e30.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.signature`;
function fixture() {
  const send = vi.fn<CognitoOptions["send"]>().mockResolvedValue({});
  const verify = vi.fn().mockResolvedValue({ sub: subject });
  const provider = createCognitoIdentityProvider({
    poolId: "us-east-1_test",
    webClientId: "web",
    mobileClientId: "mobile",
    send,
    verify,
    clock: () => new Date("2026-09-28T00:00:00Z"),
  });
  return { provider, send, verify };
}
describe("Cognito identity port", () => {
  it("sends exact registration, confirmation and resend commands", async () => {
    const { provider, send } = fixture();
    send.mockResolvedValueOnce({ UserSub: subject });
    expect(
      await provider.signUp({
        email: claims.email,
        password: "Synthetic-Only-123",
        fullName: "Layla",
        locale: "en",
      }),
    ).toEqual({ accountId: subject, destination: "l***@example.com" });
    await provider.confirmSignUp({ email: claims.email, code: "246810" });
    await provider.resendCode(claims.email);
    expect(
      send.mock.calls.map(([command]) => [
        command.constructor.name,
        command.input,
      ]),
    ).toEqual([
      [
        "SignUpCommand",
        {
          ClientId: "web",
          Username: claims.email,
          Password: "Synthetic-Only-123",
          UserAttributes: [
            { Name: "email", Value: claims.email },
            { Name: "name", Value: "Layla" },
            { Name: "locale", Value: "en" },
          ],
        },
      ],
      [
        "ConfirmSignUpCommand",
        { ClientId: "web", Username: claims.email, ConfirmationCode: "246810" },
      ],
      [
        "ResendConfirmationCodeCommand",
        { ClientId: "web", Username: claims.email },
      ],
    ]);
  });
  it.each(["web", "mobile"] as const)(
    "sends exact %s authentication, refresh and revocation commands",
    async (client) => {
      const { provider, send } = fixture();
      send.mockResolvedValue({
        AuthenticationResult: {
          AccessToken: "access",
          RefreshToken: "refresh",
          IdToken: idToken,
          ExpiresIn: 3600,
        },
      });
      expect(
        await provider.signInWithPassword({
          username: claims.email,
          password: "Synthetic-Only-123",
          client,
        }),
      ).toEqual({
        claims: {
          subject,
          email: claims.email,
          emailVerified: true,
          displayName: "Layla",
          locale: "en",
        },
        tokens: {
          accessToken: "access",
          refreshToken: "refresh",
          accessTokenExpiresAt: "2026-09-28T01:00:00.000Z",
        },
      });
      await provider.refresh("refresh", client);
      await provider.revokeRefreshToken("refresh", client);
      expect(
        send.mock.calls.map(([command]) => [
          command.constructor.name,
          command.input,
        ]),
      ).toEqual([
        [
          "AdminInitiateAuthCommand",
          {
            UserPoolId: "us-east-1_test",
            ClientId: client,
            AuthFlow: "ADMIN_USER_PASSWORD_AUTH",
            AuthParameters: {
              USERNAME: claims.email,
              PASSWORD: "Synthetic-Only-123",
            },
          },
        ],
        [
          "AdminInitiateAuthCommand",
          {
            UserPoolId: "us-east-1_test",
            ClientId: client,
            AuthFlow: "REFRESH_TOKEN_AUTH",
            AuthParameters: { REFRESH_TOKEN: "refresh" },
          },
        ],
        ["RevokeTokenCommand", { ClientId: client, Token: "refresh" }],
      ]);
    },
  );
  it("verifies access tokens before loading trusted account attributes", async () => {
    const { provider, send, verify } = fixture();
    send.mockResolvedValue({
      Username: subject,
      UserAttributes: Object.entries(claims).map(([Name, Value]) => ({
        Name,
        Value: String(Value),
      })),
    });
    expect((await provider.verifyAccessToken("access")).subject).toBe(subject);
    expect(verify).toHaveBeenCalledWith("access");
    await provider.getUserClaims(claims.email);
    expect(
      send.mock.calls.map(([command]) => [
        command.constructor.name,
        command.input,
      ]),
    ).toEqual([
      [
        "AdminGetUserCommand",
        { UserPoolId: "us-east-1_test", Username: subject },
      ],
      [
        "AdminGetUserCommand",
        { UserPoolId: "us-east-1_test", Username: claims.email },
      ],
    ]);
  });
  it("refuses challenges", async () => {
    const { provider, send } = fixture();
    send.mockResolvedValue({ ChallengeName: "SMS_MFA" });
    await expect(
      provider.signInWithPassword({
        username: claims.email,
        password: "password",
        client: "web",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it.each([
    ["UsernameExistsException", "EMAIL_TAKEN"],
    ["InvalidPasswordException", "PASSWORD_POLICY"],
    ["CodeMismatchException", "CODE_MISMATCH"],
    ["ExpiredCodeException", "CODE_EXPIRED"],
    ["NotAuthorizedException", "INVALID_CREDENTIALS"],
    ["UserNotFoundException", "INVALID_CREDENTIALS"],
    ["UserNotConfirmedException", "USER_NOT_CONFIRMED"],
    ["LimitExceededException", "RATE_LIMITED"],
    ["TooManyRequestsException", "RATE_LIMITED"],
    ["TooManyFailedAttemptsException", "RATE_LIMITED"],
    ["InvalidParameterException", "VALIDATION_FAILED"],
    ["OtherException", "UNAVAILABLE"],
  ])("maps %s to %s", async (name, code) => {
    const { provider, send } = fixture();
    const error = Object.assign(new Error("private"), { name });
    send.mockRejectedValue(error);
    await expect(provider.resendCode(claims.email)).rejects.toMatchObject({
      code,
    });
    expect(providerFailure(error).message).not.toContain("private");
  });
});
it("keeps the local adapter outside runtime entry imports", async () => {
  for (const path of ["../../handlers/http.ts", "../../app.ts", "runtime.ts"]) {
    const source = await readFile(new URL(path, import.meta.url), "utf8");
    expect(source).not.toMatch(
      /(?:from\s*|import\s*\()["'][^"']*local-identity-provider/,
    );
  }
});
it.each(Object.keys(problemStatuses) as ProblemCode[])(
  "returns an RFC 9457 problem for %s",
  async (code) => {
    const app = new Hono();
    app.get("/", (context) => problem(context, code));
    const response = await app.request("/");
    expect(response.headers.get("content-type")).toBe(
      "application/problem+json",
    );
    expect(await response.json()).toEqual({
      type: "about:blank",
      title: code.replaceAll("_", " "),
      status: problemStatuses[code],
      code,
    });
  },
);
it("masks the local part of destinations", () => {
  expect(maskEmail("layla@example.com")).toBe("l***@example.com");
});
it("creates deterministic version-five company ids", () => {
  const first = companyCreationId(subject, "synthetic-key-123");
  expect(first).toMatch(/^[\da-f-]{14}5[\da-f-]{21}$/);
  expect(companyCreationId(subject, "synthetic-key-123")).toBe(first);
  expect(companyCreationId(subject, "synthetic-key-456")).not.toBe(first);
});
it("sends UTF-8 email only through the injected transport", async () => {
  const send = vi.fn().mockResolvedValue({});
  const message = {
    to: claims.email,
    subject: "Invitation / دعوة",
    text: "Text",
    html: "<p>Text</p>",
  };
  expect(await createDisabledEmailSender().send(message)).toBe(
    "not_configured",
  );
  expect(send).not.toHaveBeenCalled();
  expect(
    await createSesEmailSender({
      from: "no-reply@example.com",
      configurationSetName: "configuration",
      send,
    }).send(message),
  ).toBe("sent");
  expect(send.mock.calls[0]?.[0]).toMatchObject({
    input: {
      FromEmailAddress: "no-reply@example.com",
      ConfigurationSetName: "configuration",
      Destination: { ToAddresses: [claims.email] },
      Content: {
        Simple: {
          Subject: { Data: message.subject, Charset: "UTF-8" },
          Body: {
            Text: { Data: message.text, Charset: "UTF-8" },
            Html: { Data: message.html, Charset: "UTF-8" },
          },
        },
      },
    },
  });
});
it("enforces local confirmation, password policy and refresh revocation", async () => {
  const provider = createLocalIdentityProvider({ confirmationCode: "246810" });
  const input = {
    email: claims.email,
    password: "Synthetic-Only-123",
    fullName: "Layla",
    locale: "en" as const,
  };
  await expect(
    provider.signUp({ ...input, password: "short" }),
  ).rejects.toMatchObject({ code: "PASSWORD_POLICY" });
  await provider.signUp(input);
  await expect(
    provider.signInWithPassword({
      username: input.email,
      password: input.password,
      client: "mobile",
    }),
  ).rejects.toMatchObject({ code: "USER_NOT_CONFIRMED" });
  await provider.confirmSignUp({ email: input.email, code: "246810" });
  const signed = await provider.signInWithPassword({
    username: input.email,
    password: input.password,
    client: "mobile",
  });
  expect(
    (await provider.verifyAccessToken(signed.tokens.accessToken)).emailVerified,
  ).toBe(true);
  const refreshed = await provider.refresh(
    signed.tokens.refreshToken,
    "mobile",
  );
  expect(refreshed.accessToken).not.toBe(signed.tokens.accessToken);
  await provider.revokeRefreshToken(refreshed.refreshToken, "mobile");
  await expect(
    provider.refresh(refreshed.refreshToken, "mobile"),
  ).rejects.toMatchObject({ code: "SESSION_INVALID" });
});
