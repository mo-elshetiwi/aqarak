import { render, screen } from "@testing-library/react-native";
import { Button } from "./button";
describe("mobile button", () => {
  it("keeps the pending label and disables interaction", async () => {
    await render(<Button label="Signing in…" loading />);
    expect(screen.getByRole("button")).toBeDisabled();
    expect(screen.getByText("Signing in…")).toBeTruthy();
  });
});
