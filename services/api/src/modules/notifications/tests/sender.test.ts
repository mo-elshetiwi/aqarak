import { SendEmailCommand } from "@aws-sdk/client-sesv2";
import { afterEach, expect, it, vi } from "vitest";
import { createSesEmailSender } from "../sender";
afterEach(() => vi.restoreAllMocks());
it.each([undefined, "synthetic-configuration"])(
  "sends UTF-8 text and HTML with configuration %s",
  async (configurationSetName) => {
    const send = vi
      .fn<
        (
          command: SendEmailCommand,
          options: { abortSignal: AbortSignal },
        ) => Promise<{ MessageId?: string }>
      >()
      .mockResolvedValue({ MessageId: "synthetic-id" });
    const client = { send };
    const timeout = vi.spyOn(AbortSignal, "timeout");
    expect(
      await createSesEmailSender({ client, configurationSetName }).send({
        to: "synthetic@example.invalid",
        subject: "العقد",
        text: "نص",
        html: '<html dir="rtl">نص</html>',
      }),
    ).toEqual({ messageId: "synthetic-id" });
    const command = send.mock.calls[0]?.[0];
    expect(command).toBeInstanceOf(SendEmailCommand);
    expect(command?.input).toEqual({
      FromEmailAddress: "notifications@aqarak.ae",
      ...(configurationSetName
        ? { ConfigurationSetName: configurationSetName }
        : {}),
      Destination: { ToAddresses: ["synthetic@example.invalid"] },
      Content: {
        Simple: {
          Subject: { Data: "العقد", Charset: "UTF-8" },
          Body: {
            Text: { Data: "نص", Charset: "UTF-8" },
            Html: { Data: '<html dir="rtl">نص</html>', Charset: "UTF-8" },
          },
        },
      },
    });
    expect(timeout).toHaveBeenCalledWith(10_000);
  },
);
it("rejects a response without a delivery identifier", async () => {
  const client = { send: vi.fn().mockResolvedValue({}) };
  await expect(
    createSesEmailSender({
      client,
      fromAddress: "synthetic@example.invalid",
    }).send({
      to: "synthetic@example.invalid",
      subject: "Synthetic",
      text: "Synthetic",
      html: "Synthetic",
    }),
  ).rejects.toThrow("Missing provider message identifier");
});
