import { SendEmailCommand } from "@aws-sdk/client-sesv2";
import type { EmailSender } from "./ports";
export function createDisabledEmailSender(): EmailSender {
  return { send: () => Promise.resolve("not_configured") };
}
export function createSesEmailSender(options: {
  from: string;
  configurationSetName: string | undefined;
  send: (command: SendEmailCommand) => Promise<unknown>;
}): EmailSender {
  return {
    async send(message) {
      await options.send(
        new SendEmailCommand({
          FromEmailAddress: options.from,
          Destination: { ToAddresses: [message.to] },
          ...(options.configurationSetName
            ? { ConfigurationSetName: options.configurationSetName }
            : {}),
          Content: {
            Simple: {
              Subject: { Data: message.subject, Charset: "UTF-8" },
              Body: {
                Text: { Data: message.text, Charset: "UTF-8" },
                Html: { Data: message.html, Charset: "UTF-8" },
              },
            },
          },
        }),
      );
      return "sent";
    },
  };
}
