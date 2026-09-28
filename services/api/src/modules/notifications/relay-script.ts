import { getConfig } from "../../config";
import { dependencyFactory } from "../contracts/runtime/dependencies";
import { deliverPendingEmails } from "./relay";
import { createSesEmailSender } from "./sender";
try {
  const dependencies = dependencyFactory()();
  const counts = await deliverPendingEmails({
    schedulerExecutor: dependencies.schedulerExecutor,
    appExecutor: dependencies.executor,
    email: createSesEmailSender({
      region: getConfig().AWS_REGION,
      fromAddress: getConfig().EMAIL_FROM_ADDRESS,
      configurationSetName: getConfig().EMAIL_CONFIGURATION_SET,
    }),
    now: dependencies.clock,
    ...(process.env.COMPANY_ID ? { companyId: process.env.COMPANY_ID } : {}),
  });
  process.stdout.write(`${JSON.stringify(counts)}\n`);
} catch {
  process.exitCode = 1;
}
