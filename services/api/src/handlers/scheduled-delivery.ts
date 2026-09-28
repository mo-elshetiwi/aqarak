import { getConfig } from "../config";
import { dependencyFactory } from "../modules/contracts/runtime/dependencies";
import { deliverPendingEmails } from "../modules/notifications/relay";
import { createSesEmailSender } from "../modules/notifications/sender";

export function isScheduledDelivery(event: unknown): boolean {
  return (
    typeof event === "object" &&
    event !== null &&
    "source" in event &&
    event.source === "aqarak.scheduler" &&
    "action" in event &&
    event.action === "deliverPendingEmails" &&
    !("requestContext" in event)
  );
}
export async function runScheduledDelivery(): ReturnType<
  typeof deliverPendingEmails
> {
  const config = getConfig();
  const dependencies = dependencyFactory()();
  return deliverPendingEmails({
    schedulerExecutor: dependencies.schedulerExecutor,
    appExecutor: dependencies.executor,
    email: createSesEmailSender({
      region: config.AWS_REGION,
      fromAddress: config.EMAIL_FROM_ADDRESS,
      configurationSetName: config.EMAIL_CONFIGURATION_SET,
    }),
    now: dependencies.clock,
    limit: 1,
  });
}
