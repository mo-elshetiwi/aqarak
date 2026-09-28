import { readFileSync } from "node:fs";
import { demoIdsSchema } from "./seed-demo";
import { runContractSmoke } from "./smoke";
try {
  const path = process.argv[2];
  if (!path) throw new Error("Demo file path required");
  const ids = demoIdsSchema.parse(
    JSON.parse(readFileSync(path, "utf8")) as unknown,
  );
  await runContractSmoke(ids, {
    sessions: {
      [ids.manager]: process.env.DEMO_MANAGER_SESSION ?? "",
      [ids.owner]: process.env.DEMO_OWNER_SESSION ?? "",
      [ids.tenant]: process.env.DEMO_TENANT_SESSION ?? "",
    },
    ...(process.env.API_BASE_URL ? { baseUrl: process.env.API_BASE_URL } : {}),
  });
} catch {
  process.stderr.write("Synthetic contract journey failed.\n");
  process.exitCode = 1;
}
