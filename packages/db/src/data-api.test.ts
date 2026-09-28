import {
  RDSDataClient,
  ExecuteStatementCommand,
  BeginTransactionCommand,
  CommitTransactionCommand,
  RollbackTransactionCommand,
} from "@aws-sdk/client-rds-data";
import { describe, expect, it, vi } from "vitest";
import {
  createDataApiExecutor,
  DataApiError,
  encodeParameter,
  retryResuming,
} from "./data-api.ts";

describe("Data API transport", () => {
  it("encodes supported scalar values and type hints without precision loss", () => {
    expect(
      [null, true, "synthetic", 42, 1.5].map(
        (value) => encodeParameter({ name: "p", value }).value,
      ),
    ).toEqual([
      { isNull: true },
      { booleanValue: true },
      { stringValue: "synthetic" },
      { longValue: 42 },
      { doubleValue: 1.5 },
    ]);
    expect(
      encodeParameter({ name: "id", value: "synthetic-id", typeHint: "UUID" })
        .typeHint,
    ).toBe("UUID");
    expect(() =>
      encodeParameter({ name: "money", value: Number.MAX_SAFE_INTEGER + 1 }),
    ).toThrow("decimal string");
    expect(() => encodeParameter({ name: "money", value: Infinity })).toThrow(
      "decimal string",
    );
  });
  it("retries a resuming or unavailable connection with jitter for at most the retry window", async () => {
    let now = 0;
    const operation = vi.fn().mockRejectedValue(
      Object.assign(new Error("Paused"), {
        name: "DatabaseResumingException",
      }),
    );
    await expect(
      retryResuming(operation, {
        now: () => now,
        random: () => 0.5,
        sleep: (ms) => {
          now += ms;
          return Promise.resolve();
        },
      }),
    ).rejects.toThrow("Paused");
    expect(now).toBe(60_000);
    expect(operation.mock.calls.length).toBeGreaterThan(1);
    const recovered = vi
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error("Connection unavailable"), {
          name: "DatabaseUnavailableException",
        }),
      )
      .mockResolvedValue("ready");
    await expect(
      retryResuming(recovered, {
        now: () => 0,
        random: () => 0,
        sleep: () => Promise.resolve(),
      }),
    ).resolves.toBe("ready");
  });
  it("preserves the raw service message and cause without retrying an ambiguous transport failure", async () => {
    const original = new Error("Connection reset after dispatch");
    const operation = vi.fn().mockRejectedValue(original);
    try {
      await retryResuming(operation);
      throw new Error("Expected error");
    } catch (error) {
      expect(error).toBeInstanceOf(DataApiError);
      if (!(error instanceof DataApiError)) throw error;
      expect(error.cause).toBe(original);
      expect(error.rawMessage).toBe(original.message);
    }
    expect(operation).toHaveBeenCalledTimes(1);
  });
  it("sends distinct transaction commands and preserves JSON bigint strings", async () => {
    const client = new RDSDataClient({
      region: "us-east-1",
      credentials: { accessKeyId: "synthetic", secretAccessKey: "synthetic" },
    });
    const responses = vi
      .fn()
      .mockResolvedValueOnce({ transactionId: "tx" })
      .mockResolvedValueOnce({
        formattedRecords: '[{"amount":"9007199254740993"}]',
        numberOfRecordsUpdated: 1,
      })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});
    const send = vi.spyOn(client, "send").mockImplementation(responses);
    const executor = createDataApiExecutor({
      client,
      database: "synthetic",
      resourceArn: "synthetic-cluster",
      secretArn: "synthetic-secret-arn",
    });
    const id = await executor.begin();
    expect(
      (
        await executor.execute(
          "select :amount",
          [{ name: "amount", value: "9007199254740993" }],
          id,
        )
      ).rows,
    ).toEqual([{ amount: "9007199254740993" }]);
    await executor.commit(id);
    await executor.rollback(id);
    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(BeginTransactionCommand);
    const command = send.mock.calls[1]?.[0];
    expect(command).toBeInstanceOf(ExecuteStatementCommand);
    if (!(command instanceof ExecuteStatementCommand))
      throw new Error("Wrong statement command");
    expect(command.input.transactionId).toBe("tx");
    expect(command.input.formatRecordsAs).toBe("JSON");
    expect(command.input.continueAfterTimeout).toBe(false);
    expect(send.mock.calls[2]?.[0]).toBeInstanceOf(CommitTransactionCommand);
    expect(send.mock.calls[3]?.[0]).toBeInstanceOf(RollbackTransactionCommand);
    client.destroy();
  });
  it("never retries a commit error and exposes its unmodified message", async () => {
    const client = new RDSDataClient({ region: "us-east-1" });
    const failure = new Error(
      "Entity version requires exactly one covering audit event in the same transaction",
    );
    const send = vi.spyOn(client, "send").mockRejectedValue(failure);
    const executor = createDataApiExecutor({
      client,
      database: "synthetic",
      resourceArn: "synthetic-cluster",
      secretArn: "synthetic-secret-arn",
    });
    await expect(executor.commit("tx")).rejects.toMatchObject({
      rawMessage: failure.message,
      cause: failure,
    });
    expect(send).toHaveBeenCalledTimes(1);
    client.destroy();
  });
});
