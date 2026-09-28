import { useState, type ReactElement } from "react";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { renderWithIntl } from "@/test/render-with-intl";
import { InstalmentBuilder } from "./instalment-builder";
import { rowsFrom, splitFils, parseFils } from "../_lib/draft-helpers";
function Builder(): ReactElement {
  const [rows, setRows] = useState(rowsFrom());
  return (
    <InstalmentBuilder
      rows={rows}
      onChange={setRows}
      totalFils={8500000}
      locale="en"
      errors={{}}
    />
  );
}
describe("Exact cheque instalment totals", () => {
  it("splits AED 85,000 across four cheques and announces a changed total", async () => {
    const user = userEvent.setup();
    renderWithIntl(<Builder />);
    await user.click(screen.getByRole("button", { name: "Split evenly" }));
    const inputs = screen.getAllByRole("textbox", {
      name: /Amount \(AED\), instalment/,
    });
    expect(inputs).toHaveLength(4);
    for (const input of inputs) expect(input).toHaveValue("21250.00");
    expect(screen.getByRole("status")).toHaveTextContent(
      "Instalments total AED 85,000.00, equal to the total.",
    );
    const first = inputs[0];
    if (!first) throw new Error("Missing instalment");
    await user.clear(first);
    await user.type(first, "21000");
    expect(screen.getByRole("status")).toHaveTextContent(
      "Instalments total AED 84,750.00, AED 250.00 below the total.",
    );
  });
  it("assigns indivisible fils to the final instalment without floating point rounding", () => {
    expect(splitFils(101, 4)).toEqual([25, 25, 25, 26]);
    expect(parseFils("21250.01")).toBe(2125001);
    expect(parseFils("1.001")).toBeNaN();
    expect(splitFils(Number.NaN, 4)).toEqual([]);
  });
});
