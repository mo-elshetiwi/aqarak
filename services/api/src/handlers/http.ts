import { handle } from "hono/aws-lambda";
import { app } from "../app";
import { initializeConfig } from "../config";
import { initializeProviderKeys } from "../models/provider-keys";
import {
  runScheduledDelivery,
  isScheduledDelivery,
} from "./scheduled-delivery";

initializeConfig();
const ready = initializeProviderKeys();
const httpHandler = handle(app);
/** I validate configuration and resolve provider credentials at cold start. */
export const handler = async (
  event: Parameters<typeof httpHandler>[0],
  context?: Parameters<typeof httpHandler>[1],
): Promise<{
  statusCode: number;
  body: string;
}> => {
  await ready;
  if (isScheduledDelivery(event)) {
    const counts = await runScheduledDelivery();
    return { statusCode: 200, body: JSON.stringify(counts) };
  }
  return httpHandler(event, context);
};
