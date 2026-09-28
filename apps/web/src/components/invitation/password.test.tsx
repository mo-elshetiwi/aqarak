import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { getMessages } from "@aqarak/i18n";
import { renderWithIntl } from "@/test/render-with-intl";
import { SignUpForm } from "@/components/auth/sign-up-form";
import { postJson } from "@/lib/client/post-json";
import { passwordPolicySchema } from "@/lib/api/contract";
import { validatePassword } from "@/components/auth/validation";
vi.mock("@/lib/client/post-json", () => ({
  postJson: vi.fn(),
  navigateDocument: vi.fn(),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it.each(["en", "ar"] as const)(
  "refuses an eleven-character password before transport in %s",
  (locale) => {
    renderWithIntl(<SignUpForm />, { locale });
    for (const [id, value] of Object.entries({
      fullName: "Synthetic Person",
      email: "synthetic@example.com",
      password: "Short-123Aa",
    })) {
      fireEvent.change(document.getElementById(id) as HTMLInputElement, {
        target: { value },
      });
    }
    fireEvent.click(
      screen.getByRole("button", { name: getMessages(locale).Auth.signUp }),
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      getMessages(locale).Auth.PASSWORD_POLICY,
    );
    expect(postJson).not.toHaveBeenCalled();
  },
);
it("requires every character class at the twelve-character boundary", () => {
  expect(passwordPolicySchema.safeParse("Abcdefghij1!").success).toBe(true);
  for (const password of [
    "abcdefghij1!",
    "ABCDEFGHIJ1!",
    "Abcdefghijk!",
    "Abcdefghij12",
    "Abcdefghi1!",
  ]) {
    expect(passwordPolicySchema.safeParse(password).success).toBe(false);
  }
});
it.each([
  ["Abcdefghi1!", false],
  ["Abcdefghij1!", true],
  ["abcdefghij1!", false],
  ["ABCDEFGHIJ1!", false],
  ["Abcdefghijk!", false],
  ["Abcdefghij12", false],
  ["Aa1!" + "x".repeat(252), true],
  ["Aa1!" + "x".repeat(253), false],
])("validates the shared password policy for %s", (password, valid) => {
  expect(validatePassword(password, "Password policy")).toEqual(
    valid ? [] : [{ fieldId: "password", message: "Password policy" }],
  );
});
