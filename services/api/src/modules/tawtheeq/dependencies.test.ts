import { describe, expect, it } from "vitest";
import { dependenciesFromEnvironment } from "./dependencies";

describe("explicit live extraction configuration", () => {
  it.each([undefined, "0", "1"])(
    "configures an available provider independently of LIVE_MODELS: %s",
    (live) => {
      const deps = dependenciesFromEnvironment({
        DATABASE_CLUSTER_ARN: "synthetic-cluster-reference",
        APP_SECRET_ARN: "synthetic-secret-reference",
        DATABASE_NAME: "aqarak_example",
        AWS_REGION: "us-east-1",
        OPENAI_API_KEY: "synthetic-test-credential",
        ...(live === undefined ? {} : { LIVE_MODELS: live }),
      });
      try {
        expect(deps.gateway).not.toBeNull();
      } finally {
        deps.s3.destroy();
      }
    },
  );
});
