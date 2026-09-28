import { describe, expect, it, vi } from "vitest";
import {
  isScheduledDelivery,
  runScheduledDelivery,
} from "./scheduled-delivery";
const relay = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    attempted: 0,
    sent: 0,
    failed: 0,
    deadLettered: 0,
    skipped: 0,
  }),
);
vi.mock("../modules/notifications/relay", () => ({
  deliverPendingEmails: relay,
}));
vi.mock("../modules/contracts/runtime/dependencies", () => ({
  dependencyFactory: () => () => ({
    schedulerExecutor: "scheduler",
    executor: "app",
    clock: () => new Date(0),
  }),
}));

describe("scheduled outbox delivery", () => {
  it("recognises only the internal scheduler payload", () => {
    const payload = {
      source: "aqarak.scheduler",
      action: "deliverPendingEmails",
    };
    expect(isScheduledDelivery(payload)).toBe(true);
    expect(isScheduledDelivery({ ...payload, requestContext: {} })).toBe(false);
    expect(
      isScheduledDelivery({ source: "other", action: payload.action }),
    ).toBe(false);
    expect(isScheduledDelivery(null)).toBe(false);
  });
  it("uses the scheduler and app roles with a bounded delivery batch", async () => {
    await expect(runScheduledDelivery()).resolves.toMatchObject({
      attempted: 0,
    });
    expect(relay).toHaveBeenCalledWith(
      expect.objectContaining({
        schedulerExecutor: "scheduler",
        appExecutor: "app",
        limit: 1,
      }),
    );
  });
});
