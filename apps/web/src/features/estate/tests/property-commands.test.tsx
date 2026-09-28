import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getMessages } from "@aqarak/i18n";
import { renderWithIntl } from "@/test/render-with-intl";
import { MOCK_COMPANY_A_ID } from "@/lib/api/mock-fixtures";
import { propertyDetailSchema, type UnitItem } from "../contract";
import propertyFixture from "./fixtures/property-detail.synthetic.json";
const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  updatePropertyAction: vi.fn(),
  changeUnitStatusAction: vi.fn(),
  updateUnitAction: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
}));
vi.mock("../actions", () => mocks);
import { PropertyEditForm } from "../components/property-edit";
import {
  UnitEditDialog,
  UnitStatusDialog,
  UnitActions,
  manualCommands,
} from "../components/unit-actions";
import { EstateHistory } from "../components/history";

function unitFixture(status: UnitItem["status"] = "vacant"): UnitItem {
  const unit = propertyDetailSchema.parse(propertyFixture).units[0];
  if (!unit) throw new Error("Missing synthetic unit");
  return { ...unit, status };
}
beforeEach(() => {
  vi.resetAllMocks();
});
describe.each(["en", "ar"] as const)(
  "%s property and unit commands",
  (locale) => {
    const t = getMessages(locale).Properties;
    const u = getMessages(locale).Units;
    it("AC-1 offers exactly vacant manual commands and requires a block reason with summary focus", async () => {
      const unit = unitFixture();
      const onSaved = vi.fn();
      renderWithIntl(
        <UnitStatusDialog
          unit={unit}
          companyId={MOCK_COMPANY_A_ID}
          propertyId={propertyFixture.id}
          onClose={vi.fn()}
          onSaved={onSaved}
        />,
        { locale },
      );
      expect(
        screen.getAllByRole("option").map((option) => option.textContent),
      ).toEqual([
        u.commands.list,
        u.commands.block,
        u.commands.open_make_ready,
      ]);
      await userEvent.selectOptions(
        screen.getByRole("combobox", { name: u.changeStatus }),
        "block",
      );
      await userEvent.type(
        screen.getByLabelText(u.reason),
        "Synthetic owner use",
      );
      await userEvent.click(screen.getByRole("button", { name: u.save }));
      expect(screen.getByRole("alert")).toHaveFocus();
      expect(screen.getAllByText(u.blockReasonRequired)).toHaveLength(2);
      expect(screen.getByLabelText(u.blockReason)).toHaveAttribute(
        "aria-invalid",
        "true",
      );
      expect(mocks.changeUnitStatusAction).not.toHaveBeenCalled();
      await userEvent.selectOptions(
        screen.getByLabelText(u.blockReason),
        "owner_use",
      );
      mocks.changeUnitStatusAction.mockResolvedValue({
        ok: true,
        data: {
          unit: {
            ...unit,
            status: "blocked",
            blockReason: "owner_use",
            version: 2,
          },
        },
      });
      await userEvent.click(screen.getByRole("button", { name: u.save }));
      expect(mocks.changeUnitStatusAction.mock.calls[0]?.[1]).toEqual({
        expectedVersion: 1,
        command: "block",
        reason: "Synthetic owner use",
        blockReason: "owner_use",
      });
      expect(onSaved).toHaveBeenCalledWith(
        expect.objectContaining({ status: "blocked" }),
      );
    });
    it("AC-1 gives occupied units no manual command or status action", async () => {
      const unit = unitFixture("occupied");
      const view = renderWithIntl(
        <UnitStatusDialog
          unit={unit}
          companyId={MOCK_COMPANY_A_ID}
          propertyId={propertyFixture.id}
          onClose={vi.fn()}
          onSaved={vi.fn()}
        />,
        { locale },
      );
      expect(screen.getByText(u.followsContract)).toBeVisible();
      expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: u.save }),
      ).not.toBeInTheDocument();
      view.unmount();
      renderWithIntl(
        <UnitActions
          unit={unit}
          companyId={MOCK_COMPANY_A_ID}
          propertyId={propertyFixture.id}
          onSaved={vi.fn()}
        />,
        { locale },
      );
      screen
        .getByRole("button", {
          name: u.actionsFor.replace("{number}", unit.unitNo),
        })
        .focus();
      await userEvent.keyboard("{ArrowDown}");
      expect(
        await screen.findByRole("menuitem", { name: u.edit }),
      ).toBeVisible();
      expect(
        screen.queryByRole("menuitem", { name: u.changeStatus }),
      ).not.toBeInTheDocument();
    });
    it("AC-2 requires a reason and names the approval effect before saving", async () => {
      const property = propertyDetailSchema.parse(propertyFixture);
      renderWithIntl(
        <PropertyEditForm property={property} companyId={MOCK_COMPANY_A_ID} />,
        { locale },
      );
      await userEvent.click(screen.getByLabelText(t.alwaysOn));
      await userEvent.click(screen.getByRole("button", { name: t.continue }));
      expect(screen.getAllByText(t.problems.REASON_REQUIRED)).toHaveLength(2);
      expect(screen.getByLabelText(t.reason)).toHaveAttribute(
        "aria-invalid",
        "true",
      );
      expect(mocks.updatePropertyAction).not.toHaveBeenCalled();
      await userEvent.type(
        screen.getByLabelText(t.reason),
        "Synthetic approval decision",
      );
      await userEvent.click(screen.getByRole("button", { name: t.continue }));
      expect(
        screen.getByRole("heading", { level: 1, name: t.checkAnswers }),
      ).toBeVisible();
      expect(screen.getByText(t.effectOn)).toBeVisible();
      expect(mocks.updatePropertyAction).not.toHaveBeenCalled();
      mocks.updatePropertyAction.mockResolvedValue({
        ok: true,
        data: { property },
      });
      await userEvent.click(screen.getByRole("button", { name: t.save }));
      expect(mocks.updatePropertyAction.mock.calls[0]?.[1]).toMatchObject({
        expectedVersion: property.version,
        ownerGateOverride: true,
        reason: "Synthetic approval decision",
      });
      expect(mocks.updatePropertyAction.mock.calls[0]?.[1]).not.toHaveProperty(
        "kind",
      );
      expect(mocks.updatePropertyAction.mock.calls[0]?.[1]).not.toHaveProperty(
        "ownerId",
      );
    });
    it("preserves an unrecorded property use while saving other editable fields", async () => {
      const property = {
        ...propertyDetailSchema.parse(propertyFixture),
        use: null,
      };
      renderWithIntl(
        <PropertyEditForm property={property} companyId={MOCK_COMPANY_A_ID} />,
        { locale },
      );
      fireEvent.change(screen.getByLabelText(t.zone), {
        target: { value: "Synthetic revised zone" },
      });
      mocks.updatePropertyAction.mockResolvedValue({
        ok: true,
        data: { property },
      });
      await userEvent.click(screen.getByRole("button", { name: t.save }));
      expect(mocks.updatePropertyAction.mock.calls[0]?.[1]).toMatchObject({
        zone: "Synthetic revised zone",
        expectedVersion: property.version,
      });
      expect(mocks.updatePropertyAction.mock.calls[0]?.[1]).not.toHaveProperty(
        "use",
      );
    });
    it("keeps unit edits on conflict and sends decimal areas as strings", async () => {
      const unit = unitFixture();
      renderWithIntl(
        <UnitEditDialog
          unit={unit}
          companyId={MOCK_COMPANY_A_ID}
          propertyId={propertyFixture.id}
          onClose={vi.fn()}
          onSaved={vi.fn()}
        />,
        { locale },
      );
      fireEvent.change(screen.getByLabelText(u.unitNo), {
        target: { value: "203" },
      });
      fireEvent.change(screen.getByLabelText(u.areaSqm), {
        target: { value: "73.25" },
      });
      mocks.updateUnitAction.mockResolvedValue({
        ok: false,
        code: "VERSION_CONFLICT",
      });
      await userEvent.click(screen.getByRole("button", { name: u.save }));
      expect(screen.getByText(u.problems.VERSION_CONFLICT)).toBeVisible();
      expect(screen.getByRole("button", { name: u.reload })).toBeVisible();
      expect(screen.getByLabelText(u.unitNo)).toHaveValue("203");
      expect(mocks.updateUnitAction.mock.calls[0]?.[1]).toMatchObject({
        expectedVersion: unit.version,
        areaSqm: "73.25",
        unitNo: "203",
      });
    });
    it("shows nullable history actors neutrally and includes only recorded reasons", () => {
      renderWithIntl(
        <EstateHistory
          namespace="Properties"
          entries={[
            {
              eventType: "property.updated",
              occurredAt: "2026-09-28T00:00:00.000Z",
              actorDisplayName: null,
              actorRole: null,
              channel: "system",
              reason: null,
            },
            {
              eventType: "unit.status_changed",
              occurredAt: "2026-09-28T01:00:00.000Z",
              actorDisplayName: "Synthetic Manager",
              actorRole: "manager",
              channel: "web_form",
              reason: "Synthetic reason",
            },
          ]}
        />,
        { locale },
      );
      expect(screen.getByText(t.unknownPerson)).toBeVisible();
      expect(screen.getByText("Synthetic reason")).toBeVisible();
      expect(screen.getAllByRole("listitem")[0]).not.toHaveTextContent(
        "Synthetic reason",
      );
    });
  },
);
it.each([
  ["listed", ["delist"]],
  ["blocked", ["unblock"]],
  ["under_maintenance", ["close_make_ready"]],
  ["reserved", []],
  ["notice_given", []],
] as const)(
  "manual commands follow the domain table for %s",
  (status, commands) => {
    expect(manualCommands(status)).toEqual(commands);
  },
);
