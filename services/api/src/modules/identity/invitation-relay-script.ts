import { runtimeDependencies } from "./runtime";
import { dependencyFactory } from "../contracts/runtime/dependencies";
import { deliverPendingInvitations } from "./invitation-relay";
try {
  const companyId = process.env.COMPANY_ID;
  if (!companyId) throw new Error("COMPANY_ID is required");
  const counts = await deliverPendingInvitations({
    deps: runtimeDependencies(),
    schedulerExecutor: dependencyFactory()().schedulerExecutor,
    companyId,
  });
  process.stdout.write(`${JSON.stringify(counts)}\n`);
} catch {
  process.stderr.write("Invitation delivery failed\n");
  process.exitCode = 1;
}
