import { describe, expect, it, vi } from "vitest";
import { createHttpApi } from "./http-adapter";
import { MOCK_ACCOUNT_IDS, MOCK_ONLY_PASSWORD } from "./mock-fixtures";
const sessionId = "a".repeat(43);
const registration = {
  email: "  New@EXAMPLE.COM ",
  password: MOCK_ONLY_PASSWORD,
  fullName: "Synthetic Account",
  locale: "en" as const,
};
function transport(response: Response): ReturnType<typeof vi.fn<typeof fetch>> {
  return vi.fn<typeof fetch>().mockResolvedValue(response);
}
describe("HTTP API contract", () => {
  it("accepts Cognito account identifiers in registration and account responses", async () => {
    const accountId = "11111111-1111-7111-f111-111111111111";
    const accepted = {
      accountId,
      delivery: { medium: "email", destination: "n***@example.com" },
    };
    const mock = transport(Response.json(accepted, { status: 201 }));
    const api = createHttpApi("https://api.example.com", mock);
    expect(await api.signUp(registration)).toEqual({
      ok: true,
      value: accepted,
    });
    const me = {
      account: {
        id: accountId,
        email: "new@example.com",
        displayName: "Synthetic Account",
        locale: "en",
      },
      contexts: [],
    };
    mock.mockResolvedValue(Response.json(me));
    expect(await api.getMe(sessionId)).toEqual({ ok: true, value: me });
  });
  it("AC-3 sends no-store, the session authorization scheme and a ten-second deadline", async () => {
    const mock = transport(new Response(null, { status: 204 }));
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const api = createHttpApi("https://api.example.com", mock);
    expect(await api.signOut(sessionId)).toEqual({ ok: true, value: null });
    expect(mock).toHaveBeenCalledWith(
      "https://api.example.com/v1/auth/sign-out",
      expect.objectContaining({
        cache: "no-store",
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: `Session ${sessionId}`,
        },
        redirect: "error",
      }),
    );
    expect(mock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
    expect(timeout).toHaveBeenCalledWith(10_000);
    timeout.mockRestore();
  });
  it("AC-3 preserves known refusal codes and normalizes email", async () => {
    const mock = transport(
      Response.json(
        {
          type: "about:blank",
          title: "Email taken",
          status: 409,
          code: "EMAIL_TAKEN",
        },
        {
          status: 409,
          headers: { "Content-Type": "application/problem+json" },
        },
      ),
    );
    expect(
      await createHttpApi("https://api.example.com", mock).signUp(registration),
    ).toEqual({ ok: false, error: { status: 409, code: "EMAIL_TAKEN" } });
    expect(mock.mock.calls[0]?.[1]?.body).toBe(
      JSON.stringify({ ...registration, email: "new@example.com" }),
    );
  });
  it.each(["timeout", "network", "503", "malformed", "wrong-status"])(
    "AC-3 maps %s to UNAVAILABLE",
    async (failure) => {
      const mock = vi.fn<typeof fetch>();
      if (failure === "timeout" || failure === "network")
        mock.mockRejectedValue(new Error(failure));
      else
        mock.mockResolvedValue(
          Response.json(failure === "503" ? { code: "EMAIL_TAKEN" } : {}, {
            status:
              failure === "503" ? 503 : failure === "wrong-status" ? 201 : 200,
          }),
        );
      expect(
        await createHttpApi("https://api.example.com", mock).getMe(sessionId),
      ).toEqual({ ok: false, error: { status: 503, code: "UNAVAILABLE" } });
    },
  );
  it.each([
    [401, "SESSION_INVALID"],
    [404, "NOT_FOUND"],
    [429, "RATE_LIMITED"],
    [403, "FORBIDDEN"],
  ] as const)(
    "maps unknown code with status %s on session routes",
    async (status, code) => {
      const api = createHttpApi(
        "https://api.example.com",
        transport(Response.json({ code: "UNKNOWN" }, { status })),
      );
      expect(await api.getMe(sessionId)).toMatchObject({ error: { code } });
    },
  );
  it("maps missing sign-in code to INVALID_CREDENTIALS", async () => {
    const api = createHttpApi(
      "https://api.example.com",
      transport(new Response("not json", { status: 401 })),
    );
    expect(
      await api.signIn({
        email: registration.email,
        password: MOCK_ONLY_PASSWORD,
        client: "web",
      }),
    ).toMatchObject({ error: { code: "INVALID_CREDENTIALS" } });
  });
  it("validates successful bodies and strips unexpected identity material", async () => {
    const mock = transport(
      Response.json(
        {
          accountId: MOCK_ACCOUNT_IDS["manager-1"],
          delivery: { medium: "email", destination: "n***@example.com" },
          accessToken: "unexpected",
        },
        { status: 201 },
      ),
    );
    const result = await createHttpApi("https://api.example.com/", mock).signUp(
      registration,
    );
    expect(result).toEqual({
      ok: true,
      value: {
        accountId: MOCK_ACCOUNT_IDS["manager-1"],
        delivery: { medium: "email", destination: "n***@example.com" },
      },
    });
  });
  it("refuses invalid input without calling the transport", async () => {
    const mock = vi.fn<typeof fetch>();
    expect(
      await createHttpApi("https://api.example.com", mock).signUp({
        ...registration,
        email: "invalid",
      }),
    ).toMatchObject({ error: { code: "VALIDATION_FAILED" } });
    expect(mock).not.toHaveBeenCalled();
  });
});

it.each([
  Response.json({}, { status: 403 }),
  Response.json({ code: "UNKNOWN" }, { status: 403 }),
  new Response("not json", { status: 403 }),
])(
  "preserves a forbidden response without a recognised code",
  async (response) => {
    const api = createHttpApi("https://api.example.com", transport(response));
    expect(await api.getMe(sessionId)).toEqual({
      ok: false,
      error: { status: 403, code: "FORBIDDEN" },
    });
  },
);
