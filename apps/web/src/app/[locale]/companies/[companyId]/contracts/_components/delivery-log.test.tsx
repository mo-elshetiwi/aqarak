import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { getMessages } from "@aqarak/i18n";
import { renderWithIntl } from "@/test/render-with-intl";
import { company, draft, key, setupMock } from "../_lib/test-fixtures";
import type { ContractDetail } from "../_lib/schemas";
import { DeliveryLog } from "./delivery-log";
async function submitted(): Promise<ContractDetail> {
  const { api, login } = setupMock();
  const manager = await login("manager-1");
  const created = await api.create(manager, company, draft(), key());
  if (!created.ok) throw new Error(created.error.code);
  const result = await api.submit(
    manager,
    company,
    created.value.contract.id,
    { expectedVersion: 1 },
    key(),
  );
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}
describe("Notification delivery log", () => {
  for (const locale of ["en", "ar"] as const) {
    it(`${locale} explains a failed email and confirms the in-app notice`, async () => {
      const detail = await submitted();
      renderWithIntl(<DeliveryLog detail={detail} locale={locale} />, {
        locale,
      });
      const m = getMessages(locale).Contracts.delivery;
      expect(screen.getByText(m.addressUnverified)).toBeInTheDocument();
      expect(screen.getByText(m.inAppDelivered)).toBeInTheDocument();
      expect(screen.queryByText("MessageRejected")).not.toBeInTheDocument();
      expect(
        screen.queryByText("contract_approval_requested"),
      ).not.toBeInTheDocument();
    });
  }
  for (const slot of ["owner", "tenant", "reader"] as const) {
    it(`never renders delivery data to a ${slot}`, async () => {
      const detail = await submitted();
      detail.viewer = { slot, allowedActions: [] };
      renderWithIntl(<DeliveryLog detail={detail} locale="en" />);
      expect(screen.queryByRole("table")).not.toBeInTheDocument();
      expect(
        screen.queryByText("Notification delivery log"),
      ).not.toBeInTheDocument();
    });
  }
  for (const attempts of [2, 8]) {
    it(`explains a transient failure after ${String(attempts)} attempts`, async () => {
      const detail = await submitted();
      detail.deliveries = detail.deliveries.map((item) =>
        item.channel === "email"
          ? {
              ...item,
              lastErrorCode: "ServiceUnavailable",
              attempts,
              deadLettered: attempts === 8,
            }
          : item,
      );
      renderWithIntl(<DeliveryLog detail={detail} locale="en" />);
      expect(
        screen.getByText(
          attempts === 8
            ? "Not delivered after 8 attempts."
            : "Not delivered, retrying (attempt 2).",
        ),
      ).toBeInTheDocument();
    });
  }
  it("does not claim an unconfirmed in-app delivery", async () => {
    const detail = await submitted();
    detail.deliveries = detail.deliveries.filter(
      (item) => item.channel !== "in_app",
    );
    renderWithIntl(<DeliveryLog detail={detail} locale="en" />);
    expect(
      screen.getByText("In-app delivery has not been confirmed."),
    ).toBeInTheDocument();
  });
});

it("does not reuse an older notice as proof of delivery for a later email", async () => {
  const detail = await submitted();
  detail.deliveries = detail.deliveries.map((item) =>
    item.channel === "in_app"
      ? { ...item, createdAt: "2026-01-01T00:00:00.000Z" }
      : item,
  );
  renderWithIntl(<DeliveryLog detail={detail} locale="en" />);
  expect(
    screen.getByText("In-app delivery has not been confirmed."),
  ).toBeInTheDocument();
});

for (const locale of ["en", "ar"] as const) {
  for (const attempts of [2, 8]) {
    it(`${locale} uses server attempt counts and exhaustion`, async () => {
      const detail = await submitted();
      detail.deliveries = detail.deliveries.map((item) =>
        item.channel === "email"
          ? {
              ...item,
              lastErrorCode: "ServiceUnavailable",
              attempts,
              deadLettered: attempts === 8,
            }
          : item,
      );
      renderWithIntl(<DeliveryLog detail={detail} locale={locale} />, {
        locale,
      });
      const messages = getMessages(locale).Contracts.delivery;
      expect(
        screen.getByText(
          attempts === 8
            ? messages.exhausted
            : messages.retrying.replace("{attempts}", String(attempts)),
        ),
      ).toBeInTheDocument();
    });
  }
}

for (const locale of ["en", "ar"] as const) {
  it(`${locale} retains address guidance alongside exhausted delivery attempts`, async () => {
    const detail = await submitted();
    detail.deliveries = detail.deliveries.map((item) =>
      item.channel === "email"
        ? { ...item, attempts: 8, deadLettered: true }
        : item,
    );
    renderWithIntl(<DeliveryLog detail={detail} locale={locale} />, { locale });
    const messages = getMessages(locale).Contracts.delivery;
    expect(screen.getByText(messages.addressUnverified)).toBeInTheDocument();
    expect(screen.getByText(messages.exhausted)).toBeInTheDocument();
  });
}
