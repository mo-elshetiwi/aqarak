import { fireEvent, screen, within, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { getMessages } from "@aqarak/i18n";
import { renderWithIntl } from "@/test/render-with-intl";
import { seedRecords } from "../_lib/fixtures";
import { ComparisonPanel } from "./comparison";
import type { RunAction } from "./use-mutation";
const fixture = seedRecords()[1];
if (!fixture) throw new Error("Missing synthetic record");
const record = fixture;
const t = getMessages("en").Tawtheeq;
function render(
  gate = true,
  run = vi.fn<RunAction>().mockResolvedValue({ ok: true, record }),
): ReturnType<typeof renderWithIntl> {
  return renderWithIntl(
    <ComparisonPanel
      record={{
        ...record,
        contract: { ...record.contract, frozenOwnerGate: gate },
      }}
      locale="en"
      run={run}
    />,
  );
}
function rentRow(): HTMLElement {
  return screen.getAllByRole("row")[1] ?? document.body;
}
describe("Tawtheeq comparison", () => {
  it("AC-1 puts material rent first, shows both values and blocks equivalence and incomplete resolution", () => {
    render();
    const row = rentRow();
    expect(row).toHaveAttribute("data-field", "annual_rent_fils");
    expect(within(row).getByText(t.classes.material)).toBeInTheDocument();
    expect(row.textContent).toContain("70,000");
    expect(row.textContent).toContain("72,000");
    expect(
      within(row).getByRole("option", { name: t.mark_equivalent }),
    ).toBeDisabled();
    expect(within(row).getByText(t.equivalentDisabled)).toBeInTheDocument();
    const button = screen.getByRole("button", {
      name: "Resolve 2 differences",
    });
    expect(button).toBeDisabled();
    fireEvent.change(within(row).getByRole("combobox"), {
      target: { value: "adopt" },
    });
    fireEvent.change(within(row).getByRole("textbox"), {
      target: { value: "Synthetic registration confirmed" },
    });
    expect(button).toBeDisabled();
    const name = screen
      .getAllByRole("row")
      .find((r) => r.getAttribute("data-field") === "tenant_name");
    if (!name) throw new Error("Missing name row");
    fireEvent.change(within(name).getByRole("combobox"), {
      target: { value: "mark_equivalent" },
    });
    expect(button).toBeDisabled();
    fireEvent.change(within(name).getByRole("textbox"), {
      target: { value: "Same synthetic name, capital letters" },
    });
    expect(button).toBeEnabled();
  });
  it.each([true, false])(
    "AC-2 describes adoption with frozen owner gate %s",
    (gate) => {
      render(gate);
      fireEvent.change(within(rentRow()).getByRole("combobox"), {
        target: { value: "adopt" },
      });
      expect(
        screen.getByTestId("consequence-annual_rent_fils"),
      ).toHaveTextContent(gate ? t.ownerConsequence : t.currentConsequence);
    },
  );
  it("retains choices and reasons and focuses the error after a failed submit", async () => {
    const run = vi
      .fn<RunAction>()
      .mockResolvedValue({ ok: false, code: "UNAVAILABLE", fieldErrors: {} });
    render(true, run);
    for (const row of screen
      .getAllByRole("row")
      .filter((r) => r.querySelector("select"))) {
      fireEvent.change(within(row).getByRole("combobox"), {
        target: { value: "adopt" },
      });
      fireEvent.change(within(row).getByRole("textbox"), {
        target: { value: "Synthetic reason kept" },
      });
    }
    fireEvent.click(
      screen.getByRole("button", { name: "Resolve 2 differences" }),
    );
    const alert = await screen.findByRole("alert");
    // I wait for the focus effect after the asynchronous response renders.
    await waitFor(() => {
      expect(alert).toHaveFocus();
    });
    expect(screen.getAllByRole("textbox")[0]).toHaveValue(
      "Synthetic reason kept",
    );
  });
});
