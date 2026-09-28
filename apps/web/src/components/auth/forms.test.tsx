import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getMessages, type Locale } from "@aqarak/i18n";
import { renderWithIntl } from "@/test/render-with-intl";
import { MOCK_ONLY_PASSWORD } from "@/lib/api/mock-fixtures";
import type { PostResult } from "@/lib/client/post-json";
import { postJson, navigateDocument } from "@/lib/client/post-json";
import { SessionProvider } from "@/components/shell/session-context";
import { SignInForm } from "./sign-in-form";
import { SignUpForm } from "./sign-up-form";
import { VerifyForm } from "./verify-form";
import { CompanyForm } from "./company-form";
vi.mock("@/lib/client/post-json", () => ({
  postJson: vi.fn(),
  navigateDocument: vi.fn(),
}));
beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);
const forms = [
  {
    id: "signIn",
    component: <SignInForm next="/en/companies/return/home" />,
    fields: { email: "synthetic@example.com", password: MOCK_ONLY_PASSWORD },
    button: "signIn",
  },
  {
    id: "signUp",
    component: <SignUpForm />,
    fields: {
      fullName: "Synthetic Test",
      email: "synthetic@example.com",
      password: MOCK_ONLY_PASSWORD,
    },
    button: "signUp",
  },
  {
    id: "verify",
    component: <VerifyForm pendingEmail="synthetic@example.com" />,
    fields: { email: "synthetic@example.com", code: "123456" },
    button: "verify",
  },
  {
    id: "company",
    component: <CompanyForm />,
    fields: {
      nameEn: "Synthetic Properties",
      nameAr: "عقارات تجريبية",
      tradeLicenceNumber: "SYNTHETIC-100",
    },
    button: "createCompany",
  },
] as const;
function fill(fields: Record<string, string>): void {
  for (const [id, value] of Object.entries(fields)) {
    const element = document.getElementById(id);
    if (!element) throw new Error(`Missing field ${id}`);
    fireEvent.change(element, { target: { value } });
  }
}
for (const locale of ["en", "ar"] as const) {
  describe(`${locale} forms with real catalogues`, () => {
    for (const form of forms) {
      it(`${form.id} preserves values, focuses the summary and prevents concurrent submissions`, async () => {
        let resolve: (result: PostResult) => void = () => {
          throw new Error("Request not pending");
        };
        vi.mocked(postJson).mockImplementation(
          () =>
            new Promise((done) => {
              resolve = done;
            }),
        );
        renderWithIntl(
          <SessionProvider csrfToken="test-csrf">
            {form.component}
          </SessionProvider>,
          { locale },
        );
        fill(form.fields);
        const label = getMessages(locale).Auth[form.button];
        const button = screen.getByRole("button", { name: label });
        fireEvent.click(button);
        expect(button).toBeDisabled();
        expect(button).toHaveTextContent(label);
        const element = button.closest("form");
        if (!element) throw new Error("Missing form");
        fireEvent.submit(element);
        expect(postJson).toHaveBeenCalledTimes(1);
        await act(async () => {
          resolve({ ok: false, code: "VALIDATION_FAILED" });
          await Promise.resolve();
        });
        await waitFor(() => {
          expect(screen.getByRole("alert")).toHaveFocus();
        });
        expect(screen.getByRole("alert")).toHaveTextContent(
          getMessages(locale).Auth.VALIDATION_FAILED,
        );
        for (const [id, value] of Object.entries(form.fields)) {
          expect(document.getElementById(id)).toHaveValue(value);
          expect(document.getElementById(`${id}-error`)).toHaveTextContent(
            getMessages(locale).Auth.VALIDATION_FAILED,
          );
        }
        expect(button).toBeEnabled();
        expect(postJson).toHaveBeenCalledWith(
          expect.stringMatching(/^\/api\//),
          expect.objectContaining(form.fields),
          { csrfToken: "test-csrf" },
        );
      });
      it(`${form.id} names and focuses invalid fields before transport`, async () => {
        renderWithIntl(form.component, { locale });
        fireEvent.click(
          screen.getByRole("button", {
            name: getMessages(locale).Auth[form.button],
          }),
        );
        await waitFor(() => {
          expect(screen.getByRole("alert")).toHaveFocus();
        });
        expect(postJson).not.toHaveBeenCalled();
        expect(
          document.querySelectorAll('[aria-invalid="true"]').length,
        ).toBeGreaterThan(0);
      });
    }
  });
}
it("changes the password toggle name and preserves next without interpreting it", async () => {
  vi.mocked(postJson).mockResolvedValue({
    ok: false,
    code: "USER_NOT_CONFIRMED",
  });
  renderWithIntl(<SignInForm next="https://attacker.example/path" />);
  fill({ email: "synthetic@example.com", password: MOCK_ONLY_PASSWORD });
  fireEvent.click(screen.getByRole("button", { name: "Show password" }));
  expect(document.getElementById("password")).toHaveAttribute("type", "text");
  fireEvent.click(screen.getByRole("button", { name: "Hide password" }));
  expect(document.getElementById("password")).toHaveAttribute(
    "type",
    "password",
  );
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
  await waitFor(() => {
    expect(navigateDocument).toHaveBeenCalledWith("/en/verify");
  });
  expect(postJson).toHaveBeenCalledWith(
    "/api/auth/sign-in",
    expect.objectContaining({ next: "https://attacker.example/path" }),
    {},
  );
});
it.each([
  "INVALID_CREDENTIALS",
  "RATE_LIMITED",
  "UNAVAILABLE",
  "FORBIDDEN_ORIGIN",
  "UNKNOWN",
])("translates sign-in refusal %s", async (code) => {
  vi.mocked(postJson).mockResolvedValue({ ok: false, code });
  renderWithIntl(<SignInForm />);
  fill({ email: "synthetic@example.com", password: MOCK_ONLY_PASSWORD });
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
  const messages = getMessages("en").Auth;
  const expected =
    code === "INVALID_CREDENTIALS"
      ? messages.INVALID_CREDENTIALS
      : code === "RATE_LIMITED"
        ? messages.RATE_LIMITED
        : messages.UNAVAILABLE;
  await waitFor(() => {
    expect(screen.getByRole("alert")).toHaveFocus();
  });
  expect(screen.getByRole("alert")).toHaveTextContent(expected);
});
it("prefills verification email, resends politely and confirms with a notice destination", async () => {
  vi.mocked(postJson).mockResolvedValue({ ok: true, redirectTo: "" });
  renderWithIntl(<VerifyForm pendingEmail="synthetic@example.com" />);
  expect(document.getElementById("email")).toHaveValue("synthetic@example.com");
  fireEvent.click(screen.getByRole("button", { name: "Send a new code" }));
  await waitFor(() => {
    expect(screen.getByRole("status")).toHaveTextContent("We sent a new code.");
  });
  vi.mocked(postJson).mockResolvedValue({
    ok: true,
    redirectTo: "/en/sign-in",
  });
  fill({ code: "246810" });
  fireEvent.click(screen.getByRole("button", { name: "Confirm email" }));
  await waitFor(() => {
    expect(navigateDocument).toHaveBeenCalledWith("/en/sign-in?confirmed=1");
  });
});
it.each(["CODE_MISMATCH", "CODE_EXPIRED"] as const)(
  "associates %s with the code",
  async (code) => {
    vi.mocked(postJson).mockResolvedValue({ ok: false, code });
    renderWithIntl(<VerifyForm pendingEmail="synthetic@example.com" />);
    fill({ code: "123456" });
    fireEvent.click(screen.getByRole("button", { name: "Confirm email" }));
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveFocus();
    });
    expect(document.getElementById("code-error")).toHaveTextContent(
      getMessages("en").Auth[code],
    );
  },
);
it("links an existing account refusal to sign-in", async () => {
  vi.mocked(postJson).mockResolvedValue({ ok: false, code: "EMAIL_TAKEN" });
  renderWithIntl(<SignUpForm />);
  fill({
    fullName: "Synthetic Test",
    email: "synthetic@example.com",
    password: MOCK_ONLY_PASSWORD,
  });
  fireEvent.click(screen.getByRole("button", { name: "Create account" }));
  await waitFor(() => {
    expect(screen.getByRole("alert")).toHaveFocus();
  });
  expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
    "href",
    "/sign-in",
  );
});
it("omits the hidden licence when creating a self-managed company", async () => {
  vi.mocked(postJson).mockResolvedValue({
    ok: true,
    redirectTo: "/en/companies/new/home",
  });
  renderWithIntl(
    <SessionProvider csrfToken="test-csrf">
      <CompanyForm />
    </SessionProvider>,
  );
  fill({
    nameEn: "Synthetic Properties",
    nameAr: "عقارات تجريبية",
    tradeLicenceNumber: "SYNTHETIC-100",
  });
  fireEvent.click(
    screen.getByRole("radio", { name: "I manage my own properties" }),
  );
  expect(document.getElementById("tradeLicenceNumber")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Create company" }));
  await waitFor(() => {
    expect(navigateDocument).toHaveBeenCalled();
  });
  expect(postJson).toHaveBeenCalledWith(
    "/api/companies",
    {
      locale: "en",
      kind: "self_managed_owner",
      nameEn: "Synthetic Properties",
      nameAr: "عقارات تجريبية",
      idempotencyKey: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      ) as unknown,
    },
    { csrfToken: "test-csrf" },
  );
});
it.each(["en", "ar"] as Locale[])(
  "uses language-tagged native language names in %s",
  (locale) => {
    renderWithIntl(<SignUpForm />, { locale });
    expect(screen.getByText("English")).toHaveAttribute("lang", "en");
    expect(screen.getByText("العربية")).toHaveAttribute("lang", "ar");
  },
);
