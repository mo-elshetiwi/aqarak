import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import type { EmailContent } from "./render";
export interface EmailSender {
  send(message: EmailContent & { to: string }): Promise<{ messageId: string }>;
}
export function createSesEmailSender(config: {
  region?: string | undefined;
  fromAddress?: string | undefined;
  configurationSetName?: string | undefined;
  client?: {
    send(
      command: SendEmailCommand,
      options: { abortSignal: AbortSignal },
    ): Promise<{ MessageId?: string }>;
  };
}): EmailSender {
  const client =
    config.client ??
    new SESv2Client({
      ...(config.region ? { region: config.region } : {}),
      maxAttempts: 1,
    });
  return {
    async send(message) {
      const content = (Data: string) => ({ Data, Charset: "UTF-8" });
      const result = await client.send(
        new SendEmailCommand({
          FromEmailAddress: config.fromAddress ?? "notifications@aqarak.ae",
          ...(config.configurationSetName
            ? { ConfigurationSetName: config.configurationSetName }
            : {}),
          Destination: { ToAddresses: [message.to] },
          Content: {
            Simple: {
              Subject: content(message.subject),
              Body: {
                Text: content(message.text),
                Html: content(message.html),
              },
            },
          },
        }),
        { abortSignal: AbortSignal.timeout(10_000) },
      );
      if (!result.MessageId)
        throw new Error("Missing provider message identifier");
      return { messageId: result.MessageId };
    },
  };
}
