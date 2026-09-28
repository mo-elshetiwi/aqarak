import { fireEvent, render, screen } from "@testing-library/react-native";
import { getDocumentAsync } from "expo-document-picker";
import { getMessages } from "@aqarak/i18n";
import { LocaleProvider } from "@/features/locale/locale-provider";
import { captureTestFiles } from "@/testing/file-system";
import { CaptureSheet } from "./capture-sheet";
import { CaptureStorage } from "./storage";
jest.mock("./camera-capture", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  const { Text } =
    jest.requireActual<typeof import("react-native")>("react-native");
  return {
    CameraCapture: ({ initialMode }: { initialMode: string }) =>
      React.createElement(Text, { testID: "camera-selection" }, initialMode),
  };
});
jest.mock("./voice-note", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  const { Text } =
    jest.requireActual<typeof import("react-native")>("react-native");
  return {
    VoiceNoteCapture: () =>
      React.createElement(Text, { testID: "voice-selection" }, "voice_note"),
  };
});
async function storage(): Promise<CaptureStorage> {
  const value = new CaptureStorage();
  await value.activate("account:company");
  return value;
}
it.each(["en", "ar"] as const)(
  "%s capture sheet exposes all four options and document quality guidance",
  async (locale) => {
    const messages = getMessages(locale).Mobile.Capture;
    await render(
      <LocaleProvider initialLocale={locale}>
        <CaptureSheet
          visible
          storage={await storage()}
          onCapture={jest.fn()}
          onClose={jest.fn()}
        />
      </LocaleProvider>,
    );
    for (const option of ["photo", "video", "voice-note", "document"])
      expect(screen.getByTestId(`capture-option-${option}`)).toBeTruthy();
    expect(screen.getByText(messages.goodDocument)).toBeTruthy();
    expect(screen.getByText(messages.refusedDocument)).toBeTruthy();
    expect(screen.getByText(messages.acceptsDocument)).toBeTruthy();
  },
);
it.each(["photo", "video", "voice-note"] as const)(
  "selecting %s opens the corresponding capture component",
  async (mode) => {
    await render(
      <LocaleProvider initialLocale="en">
        <CaptureSheet
          visible
          storage={await storage()}
          onCapture={jest.fn()}
          onClose={jest.fn()}
        />
      </LocaleProvider>,
    );
    await fireEvent.press(screen.getByTestId(`capture-option-${mode}`));
    expect(
      screen.getByTestId(
        mode === "voice-note" ? "voice-selection" : "camera-selection",
      ),
    ).toHaveTextContent(mode === "voice-note" ? "voice_note" : mode);
  },
);
it("a document picked from the sheet is copied privately and returned once", async () => {
  const uri = "file:///private-cache/picker/synthetic.pdf";
  captureTestFiles.set(uri, 2048);
  jest.mocked(getDocumentAsync).mockResolvedValue({
    canceled: false,
    assets: [
      {
        uri,
        name: "synthetic.pdf",
        mimeType: "application/pdf",
        size: 2048,
        lastModified: 0,
      },
    ],
  });
  const captured = jest.fn();
  const close = jest.fn();
  await render(
    <LocaleProvider initialLocale="en">
      <CaptureSheet
        visible
        storage={await storage()}
        onCapture={captured}
        onClose={close}
      />
    </LocaleProvider>,
  );
  await fireEvent.press(screen.getByTestId("capture-option-document"));
  expect(captured).toHaveBeenCalledTimes(1);
  expect(captured.mock.calls).toMatchObject([
    [{ kind: "document", sizeBytes: 2048 }],
  ]);
  expect(close).toHaveBeenCalledTimes(1);
  expect(captureTestFiles.has(uri)).toBe(false);
});
