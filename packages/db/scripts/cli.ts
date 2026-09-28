import { parseArgs } from "node:util";
import { RDSDataClient } from "@aws-sdk/client-rds-data";
import {
  createDataApiExecutor,
  type DataApiExecutor,
} from "../src/data-api.ts";

export interface LocalOptions {
  clusterArn: string;
  masterSecretArn: string;
  appSecretArn: string;
  database: string;
  region: string;
  bucket: string;
  out: string;
}
function configureLocalCredentials(): void {
  if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY)
    delete process.env.AWS_PROFILE;
  else process.env.AWS_PROFILE = "aqarak-dev";
}
export function localOptions(): LocalOptions {
  const args = process.argv.slice(2);
  const { values } = parseArgs({
    args: args[0] === "--" ? args.slice(1) : args,
    options: {
      "cluster-arn": { type: "string" },
      "master-secret-arn": { type: "string" },
      "app-secret-arn": { type: "string" },
      database: { type: "string" },
      region: { type: "string", default: "us-east-1" },
      profile: { type: "string", default: "aqarak-dev" },
      bucket: { type: "string" },
      out: { type: "string" },
    },
  });
  if (values.profile !== "aqarak-dev" || values.region !== "us-east-1")
    throw new Error("Local database commands require aqarak-dev in us-east-1");
  configureLocalCredentials();
  return {
    clusterArn: values["cluster-arn"] ?? process.env.DATABASE_CLUSTER_ARN ?? "",
    masterSecretArn:
      values["master-secret-arn"] ?? process.env.MASTER_SECRET_ARN ?? "",
    appSecretArn: values["app-secret-arn"] ?? process.env.APP_SECRET_ARN ?? "",
    database: values.database ?? process.env.DATABASE_NAME ?? "aqarak",
    region: values.region,
    bucket: values.bucket ?? "",
    out: values.out ?? "",
  };
}
export function localExecutor(
  options: LocalOptions,
  secretArn: string,
): DataApiExecutor {
  if (!options.clusterArn || !secretArn)
    throw new Error("Cluster and database secret ARNs are required");
  return createDataApiExecutor({
    resourceArn: options.clusterArn,
    secretArn,
    database: options.database,
    client: new RDSDataClient({ region: options.region, maxAttempts: 1 }),
  });
}
