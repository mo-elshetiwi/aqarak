import { RDSDataClient } from "@aws-sdk/client-rds-data";
import { createDataApiExecutor } from "@aqarak/db/data-api";
import { seedDemo } from "./seed-demo";
try {
  const resourceArn =
    process.env.DATABASE_CLUSTER_ARN ?? process.env.AQARAK_IT_CLUSTER_ARN;
  const secretArn =
    process.env.APP_SECRET_ARN ?? process.env.AQARAK_IT_APP_SECRET_ARN;
  const database =
    process.env.DATABASE_NAME ?? process.env.AQARAK_IT_DATABASE_NAME;
  const region = process.env.AWS_REGION;
  if (!resourceArn || !secretArn || !database || !region)
    throw new Error("Development database configuration required");
  const ids = await seedDemo(
    createDataApiExecutor({
      resourceArn,
      secretArn,
      database,
      client: new RDSDataClient({ region, maxAttempts: 1 }),
    }),
  );
  process.stdout.write(`${JSON.stringify(ids)}\n`);
} catch {
  process.stderr.write("Synthetic demo creation failed.\n");
  process.exitCode = 1;
}
