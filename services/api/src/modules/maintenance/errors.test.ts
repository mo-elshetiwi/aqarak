import { randomUUID } from "node:crypto";
import { DataApiError } from "@aqarak/db/data-api";
import { RDSDataServiceException } from "@aws-sdk/client-rds-data";
import { S3ServiceException } from "@aws-sdk/client-s3";
import { expect, it, vi } from "vitest";
import { createRuntime } from "./runtime";
import { problemCodeSchema } from "./contract";

it("returns INTERNAL_ERROR and one redacted diagnostic for an unexpected failure", async () => {
  const write = vi.spyOn(process.stderr, "write").mockReturnValue(true);
  const runtime = createRuntime({
    authenticate: () =>
      Promise.resolve({ subject: "00000000-0000-4000-8000-000000000001" }),
  });
  try {
    const response = await runtime.handle(
      new Request("https://synthetic.invalid/route", {
        method: "POST",
        headers: { authorization: "Bearer private-token" },
        body: JSON.stringify({ description: "private-body" }),
      }),
      randomUUID(),
      () => Promise.reject(new TypeError("Failed private-body private-token")),
    );
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ code: "INTERNAL_ERROR" });
    expect(write).toHaveBeenCalledOnce();
    const line = String(write.mock.calls[0]?.[0]);
    expect(line).not.toContain("private-body");
    expect(line).not.toContain("private-token");
    expect(JSON.parse(line)).toMatchObject({
      route: "/route",
      name: "TypeError",
      message: "Failed [redacted] [redacted]",
    });
  } finally {
    write.mockRestore();
  }
});
it.each([
  new DataApiError(
    new RDSDataServiceException({
      name: "ServiceUnavailableError",
      message: "unavailable",
      $fault: "server",
      $metadata: {},
    }),
  ),
  new RDSDataServiceException({
    name: "ServiceUnavailableError",
    message: "unavailable",
    $fault: "server",
    $metadata: {},
  }),
  new S3ServiceException({
    name: "InternalError",
    message: "unavailable",
    $fault: "server",
    $metadata: { httpStatusCode: 503 },
  }),
])("keeps dependency outages as SERVICE_UNAVAILABLE", async (error) => {
  const runtime = createRuntime({
    authenticate: () =>
      Promise.resolve({ subject: "00000000-0000-4000-8000-000000000001" }),
  });
  const response = await runtime.handle(
    new Request("https://synthetic.invalid/route"),
    randomUUID(),
    () => Promise.reject(error),
  );
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({ code: "SERVICE_UNAVAILABLE" });
});
it("exports a closed problem code contract", () => {
  expect(problemCodeSchema.safeParse("INVALID_INPUT").success).toBe(true);
  expect(problemCodeSchema.safeParse("arbitrary").success).toBe(false);
});
