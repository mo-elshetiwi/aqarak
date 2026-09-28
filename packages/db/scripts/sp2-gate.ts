import { writeFile } from "node:fs/promises";
import { RDSDataClient } from "@aws-sdk/client-rds-data";
import { S3Client } from "@aws-sdk/client-s3";
import { runSp2Gate } from "../src/spike/sp2.ts";
import { localExecutor, localOptions } from "./cli.ts";

try {
  const options = localOptions();
  if (!options.bucket || !options.out)
    throw new Error("Spike gate requires --bucket and --out");
  const client = new RDSDataClient({ region: options.region, maxAttempts: 1 });
  const s3 = new S3Client({ region: options.region });
  try {
    const result = await runSp2Gate({
      executor: localExecutor(options, options.appSecretArn),
      rawCommit: {
        client,
        resourceArn: options.clusterArn,
        secretArn: options.appSecretArn,
      },
      s3,
      bucket: options.bucket,
      clientLocation: "Measured from the local CLI client location",
    });
    await writeFile(options.out, `${JSON.stringify(result, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.passed) process.exitCode = 1;
  } finally {
    client.destroy();
    s3.destroy();
  }
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Spike failed"}\n`,
  );
  process.exitCode = 1;
}
