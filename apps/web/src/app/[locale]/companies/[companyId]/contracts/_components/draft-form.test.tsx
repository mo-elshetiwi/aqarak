import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithIntl } from "@/test/render-with-intl";
import { mockDraftingOptions } from "../_lib/contracts-mock";
import { company, draft } from "../_lib/test-fixtures";
import { DraftForm } from "./draft-form";
const calls = vi.hoisted(() => ({
  create: vi.fn(),
  edit: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
  suggest: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: calls.push, refresh: calls.refresh }),
}));
vi.mock("../_lib/suggestion-action", () => ({ suggestClause: calls.suggest }));
vi.mock("../_lib/actions", () => ({
  createContract: calls.create,
  editContract: calls.edit,
}));
beforeEach(() => {
  vi.clearAllMocks();
});
describe("Draft form failure recovery", () => {
  it("preserves dates and terms after local validation and focuses the named field error", async () => {
    const user = userEvent.setup();
    renderWithIntl(
      <DraftForm
        options={mockDraftingOptions}
        locale="en"
        companyId={company}
        csrfToken="token"
        commandKey={"a".repeat(32)}
        initial={draft()}
      />,
    );
    fireEvent.change(screen.getByLabelText("Start date"), {
      target: { value: "2028-10-01" },
    });
    await user.click(await screen.findByRole("button", { name: "Save draft" }));
    expect(calls.create).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Start date")).toHaveValue("2028-10-01");
    expect(screen.getByRole("alert")).toHaveFocus();
    expect(screen.getByLabelText("End date")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });
  it("keeps input after a service refusal and gives each save tap its own key", async () => {
    calls.create.mockResolvedValue({ ok: false, code: "UNAVAILABLE" });
    const user = userEvent.setup();
    renderWithIntl(
      <DraftForm
        options={mockDraftingOptions}
        locale="en"
        companyId={company}
        csrfToken="token"
        commandKey={"a".repeat(32)}
        initial={draft()}
      />,
    );
    fireEvent.change(screen.getByLabelText("Start date"), {
      target: { value: "2026-11-01" },
    });
    await user.click(await screen.findByRole("button", { name: "Save draft" }));
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Could not reach the service. Your input is kept; try again.",
      );
    });
    expect(screen.getByLabelText("Start date")).toHaveValue("2026-11-01");
    await user.click(await screen.findByRole("button", { name: "Save draft" }));
    await waitFor(() => {
      expect(calls.create).toHaveBeenCalledTimes(2);
    });
    const first: unknown = calls.create.mock.calls[0]?.[0];
    const second: unknown = calls.create.mock.calls[1]?.[0];
    expect(first).not.toEqual(second);
    expect(first).toMatchObject({
      input: expect.objectContaining({ termStart: "2026-11-01" }) as unknown,
    });
    expect(second).toMatchObject({
      input: expect.objectContaining({ termStart: "2026-11-01" }) as unknown,
    });
    expect(calls.push).not.toHaveBeenCalled();
  });
});

it("keeps an edited rent and shows the reload message on a stale version", async () => {
  calls.edit.mockResolvedValue({ ok: false, code: "VERSION_CONFLICT" });
  renderWithIntl(
    <DraftForm
      options={mockDraftingOptions}
      locale="en"
      companyId={company}
      csrfToken="token"
      commandKey={"a".repeat(32)}
      initial={draft()}
      contractId="60000000-0000-4000-8000-000000000001"
      version={1}
    />,
  );
  fireEvent.change(screen.getByLabelText("Annual rent (AED)"), {
    target: { value: "90000" },
  });
  await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() => {
    expect(screen.getByRole("alert")).toHaveTextContent(
      "This contract changed since you opened it. Reload to see the current version.",
    );
  });
  expect(screen.getByLabelText("Annual rent (AED)")).toHaveValue("90000");
  expect(calls.edit).toHaveBeenCalledWith(
    expect.objectContaining({
      input: expect.objectContaining({
        expectedVersion: 1,
        terms: expect.objectContaining({ annualRentFils: 9000000 }) as unknown,
      }) as unknown,
    }),
  );
  expect(calls.refresh).not.toHaveBeenCalled();
});
it("preserves an instalment without a cheque when saving an existing draft", async () => {
  calls.edit.mockResolvedValue({
    ok: true,
    contractId: "60000000-0000-4000-8000-000000000001",
  });
  const initial = draft();
  initial.instalments = initial.instalments.map((item) => ({
    ...item,
    cheque: null,
  }));
  renderWithIntl(
    <DraftForm
      options={mockDraftingOptions}
      locale="en"
      companyId={company}
      csrfToken="token"
      commandKey={"a".repeat(32)}
      initial={initial}
      contractId="60000000-0000-4000-8000-000000000001"
      version={1}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() => {
    expect(calls.edit).toHaveBeenCalledTimes(1);
  });
  expect(calls.edit).toHaveBeenCalledWith(
    expect.objectContaining({
      input: expect.objectContaining({
        terms: expect.objectContaining({
          instalments: initial.instalments,
        }) as unknown,
      }) as unknown,
    }),
  );
});

it("requires explicit use and keeps the suggestion reference after a manual Arabic edit", async () => {
  const user = userEvent.setup();
  const provenance = {
    registryEntry: "synthetic-translation",
    promptVersion: "1",
    outputSha256: "a".repeat(64),
  };
  calls.suggest.mockResolvedValue({
    ok: true,
    value: {
      suggestionId: "60000000-0000-4000-8000-000000000099",
      suggestion: { textAr: "نص مقترح", warnings: [] },
      provenance: { ...provenance, ranAt: "2026-09-28T06:00:00.000Z" },
    },
  });
  calls.edit.mockResolvedValue({ ok: false, code: "UNAVAILABLE" });
  const initial = draft();
  initial.specialClauses = [
    {
      textEn: "Synthetic clause",
      textAr: "نص أصلي",
      modelTranslated: false,
    },
  ];
  renderWithIntl(
    <DraftForm
      options={mockDraftingOptions}
      locale="en"
      companyId={company}
      csrfToken="token"
      commandKey={"a".repeat(32)}
      initial={initial}
      contractId="60000000-0000-4000-8000-000000000001"
      version={1}
      canSuggest
    />,
  );
  await user.click(
    screen.getByRole("button", { name: "Suggest Arabic translation" }),
  );
  await screen.findByRole("button", { name: "Use this translation" });
  expect(screen.getByLabelText("Special clauses in Arabic")).toHaveValue(
    "نص أصلي",
  );
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() => {
    expect(calls.edit).toHaveBeenCalledTimes(1);
  });
  const typed: unknown = calls.edit.mock.calls[0]?.[0];
  expect(JSON.stringify(typed)).not.toContain("suggestionId");
  expect(JSON.stringify(typed)).not.toContain("provenance");
  await waitFor(() => {
    expect(
      screen.getByRole("button", { name: "Use this translation" }),
    ).toBeEnabled();
  });
  await user.click(
    screen.getByRole("button", { name: "Use this translation" }),
  );
  await waitFor(() => {
    expect(screen.getByLabelText("Special clauses in Arabic")).toHaveValue(
      "نص مقترح",
    );
  });
  fireEvent.change(screen.getByLabelText("Special clauses in Arabic"), {
    target: { value: "نص مقترح بعد التعديل" },
  });
  await user.click(await screen.findByRole("button", { name: "Save changes" }));
  await waitFor(() => {
    expect(calls.edit).toHaveBeenCalledTimes(2);
  });
  expect(calls.edit).toHaveBeenCalledWith(
    expect.objectContaining({
      input: expect.objectContaining({
        terms: expect.objectContaining({
          specialClauses: [
            {
              textEn: "Synthetic clause",
              textAr: "نص مقترح بعد التعديل",
              modelTranslated: true,
              suggestionId: "60000000-0000-4000-8000-000000000099",
            },
          ],
        }) as unknown,
      }) as unknown,
    }),
  );
});
it("leaves Arabic untouched when suggestions are unavailable", async () => {
  calls.suggest.mockResolvedValue({ ok: false, code: "MODEL_UNAVAILABLE" });
  const initial = draft();
  initial.specialClauses = [
    {
      textEn: "unavailable",
      textAr: "نص أصلي",
      modelTranslated: false,
    },
  ];
  renderWithIntl(
    <DraftForm
      options={mockDraftingOptions}
      locale="en"
      companyId={company}
      csrfToken="token"
      commandKey={"a".repeat(32)}
      initial={initial}
      contractId="60000000-0000-4000-8000-000000000001"
      version={1}
      canSuggest
    />,
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Suggest Arabic translation" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Suggestions are unavailable right now. You can type the Arabic text yourself.",
  );
  expect(screen.getByLabelText("Special clauses in Arabic")).toHaveValue(
    "نص أصلي",
  );
});
it("dismisses a suggestion and prevents use after the English source changes", async () => {
  calls.suggest.mockResolvedValue({
    ok: true,
    value: {
      suggestionId: "60000000-0000-4000-8000-000000000099",
      suggestion: { textAr: "نص مقترح", warnings: ["Synthetic warning"] },
      provenance: {
        registryEntry: "synthetic",
        promptVersion: "1",
        outputSha256: "a".repeat(64),
      },
    },
  });
  const initial = draft();
  initial.specialClauses = [
    {
      textEn: "Synthetic clause",
      textAr: "نص أصلي",
      modelTranslated: false,
    },
  ];
  renderWithIntl(
    <DraftForm
      options={mockDraftingOptions}
      locale="en"
      companyId={company}
      csrfToken="token"
      commandKey={"a".repeat(32)}
      initial={initial}
      contractId="60000000-0000-4000-8000-000000000001"
      version={1}
      canSuggest
    />,
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Suggest Arabic translation" }),
  );
  await screen.findByRole("button", { name: "Use this translation" });
  expect(screen.getByText("Synthetic warning")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Special clauses in English"), {
    target: { value: "Changed source" },
  });
  expect(
    screen.getByRole("button", { name: "Use this translation" }),
  ).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
  expect(
    screen.queryByRole("button", { name: "Use this translation" }),
  ).not.toBeInTheDocument();
  expect(screen.getByLabelText("Special clauses in Arabic")).toHaveValue(
    "نص أصلي",
  );
});

it("shows a single route back when no drafting choices are available", () => {
  renderWithIntl(
    <DraftForm
      options={{ units: [], tenants: [] }}
      locale="en"
      companyId={company}
      csrfToken="token"
      commandKey={"a".repeat(32)}
    />,
  );
  expect(
    screen.getByText("No units or tenants are available for a new contract."),
  ).toBeInTheDocument();
  expect(screen.getAllByRole("button")).toHaveLength(1);
  expect(
    screen.getByRole("button", { name: "All contracts" }),
  ).toBeInTheDocument();
});
