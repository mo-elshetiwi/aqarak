import {
  BeginTransactionCommand,
  CommitTransactionCommand,
  ExecuteStatementCommand,
  RollbackTransactionCommand,
  type RDSDataClient,
  type SqlParameter,
} from "@aws-sdk/client-rds-data";

export interface Parameter {
  name: string;
  value: string | number | boolean | null;
  typeHint?: "UUID" | "TIMESTAMP" | "DATE" | "JSON";
}
export type Row = Record<string, unknown>;
export interface ExecuteResult {
  rows: Row[];
  numberOfRecordsUpdated: number;
}
export interface DataApiExecutor {
  begin: () => Promise<string>;
  execute: (
    sql: string,
    params?: readonly Parameter[],
    transactionId?: string,
  ) => Promise<ExecuteResult>;
  commit: (id: string) => Promise<void>;
  rollback: (id: string) => Promise<void>;
}
export interface DataApiOptions {
  resourceArn: string;
  secretArn: string;
  database: string;
  client: RDSDataClient;
}
export class DataApiError extends Error {
  readonly rawMessage: string;
  constructor(cause: unknown) {
    const message = cause instanceof Error ? cause.message : String(cause);
    super(message, { cause });
    this.name = "DataApiError";
    this.rawMessage = message;
  }
}
export function encodeParameter(parameter: Parameter): SqlParameter {
  const { value } = parameter;
  if (
    typeof value === "number" &&
    (!Number.isFinite(value) ||
      (Number.isInteger(value) && !Number.isSafeInteger(value)))
  ) {
    throw new Error("Use a decimal string for integers outside the safe range");
  }
  return {
    name: parameter.name,
    ...(parameter.typeHint ? { typeHint: parameter.typeHint } : {}),
    value:
      value === null
        ? { isNull: true }
        : typeof value === "string"
          ? { stringValue: value }
          : typeof value === "boolean"
            ? { booleanValue: value }
            : Number.isInteger(value)
              ? { longValue: value }
              : { doubleValue: value },
  };
}
export interface RetryOptions {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  random: () => number;
}
const retryDefaults: RetryOptions = {
  now: Date.now,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  random: Math.random,
};
export async function retryResuming<T>(
  operation: () => Promise<T>,
  options: RetryOptions = retryDefaults,
): Promise<T> {
  const deadline = options.now() + 60_000;
  let attempt = 0;
  for (;;) {
    try {
      return await operation();
    } catch (cause) {
      const name = cause instanceof Error ? cause.name : "";
      const remaining = deadline - options.now();
      // These service errors report that no SQL could run. Ambiguous transport failures are not replayed.
      if (
        ![
          "DatabaseResumingException",
          "DatabaseUnavailableException",
          "ServiceUnavailableError",
        ].includes(name) ||
        remaining <= 0
      )
        throw new DataApiError(cause);
      await options.sleep(
        Math.min(
          remaining,
          250 + options.random() * Math.min(5000, 250 * 2 ** attempt++),
        ),
      );
    }
  }
}
function parseRows(formattedRecords: string | undefined): Row[] {
  const parsed: unknown = JSON.parse(formattedRecords ?? "[]");
  if (
    !Array.isArray(parsed) ||
    !parsed.every(
      (row: unknown) =>
        typeof row === "object" && row !== null && !Array.isArray(row),
    )
  )
    throw new Error("Invalid Data API JSON rows");
  return parsed as Row[];
}
export function createDataApiExecutor(
  options: DataApiOptions,
): DataApiExecutor {
  const { client, ...connection } = options;
  return {
    async begin() {
      const result = await retryResuming(() =>
        client.send(new BeginTransactionCommand(connection)),
      );
      if (!result.transactionId)
        throw new Error("Data API omitted transaction id");
      return result.transactionId;
    },
    async execute(sql, params = [], transactionId) {
      const result = await retryResuming(() =>
        client.send(
          new ExecuteStatementCommand({
            ...connection,
            sql,
            parameters: params.map(encodeParameter),
            ...(transactionId ? { transactionId } : {}),
            formatRecordsAs: "JSON",
            resultSetOptions: {
              longReturnType: "STRING",
              decimalReturnType: "STRING",
            },
            continueAfterTimeout: false,
          }),
        ),
      );
      return {
        rows: parseRows(result.formattedRecords),
        numberOfRecordsUpdated: result.numberOfRecordsUpdated ?? 0,
      };
    },
    async commit(transactionId) {
      // A lost commit response is ambiguous and must never be retried.
      try {
        await client.send(
          new CommitTransactionCommand({ ...connection, transactionId }),
        );
      } catch (cause) {
        throw new DataApiError(cause);
      }
    },
    async rollback(transactionId) {
      try {
        await client.send(
          new RollbackTransactionCommand({ ...connection, transactionId }),
        );
      } catch (cause) {
        throw new DataApiError(cause);
      }
    },
  };
}
