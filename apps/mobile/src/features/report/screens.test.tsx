import type { ReactNode } from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import {
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { getMessages, type Locale } from "@aqarak/i18n";
import type { Result } from "@aqarak/domain";
import type { CapturedMedia, CaptureError } from "@/features/capture/media";
import { CaptureProvider } from "@/features/capture/capture-provider";
import { LocaleProvider } from "@/features/locale/locale-provider";
import { emitSessionEvent } from "@/features/auth/session-events";
import type { SessionState } from "@/features/auth/session";
import MaintenanceScreen from "@/app/(tenant)/tenant/maintenance";
import { ReportScreen } from "./report-screen";
import { ReviewScreen } from "./review-screen";
import * as upload from "./upload";
import {
  confirmIntakeBodySchema,
  intakeBodySchema,
  uploadBodySchema,
  type IntakeView,
  type ReportUnit,
} from "./contract";
import {
  syntheticId,
  syntheticIntake,
  syntheticMedia,
  syntheticTicket,
  syntheticUpload,
  jsonResponse,
} from "./test-support";

const mockRouter = { push: jest.fn(), replace: jest.fn() };
jest.mock("expo-router", () => {
  const actual =
    jest.requireActual<typeof import("expo-router")>("expo-router");
  return { ...actual, useRouter: () => mockRouter, router: mockRouter };
});
jest.mock("@/config", () => ({
  config: { adapter: "http", baseUrl: "https://api.example.test" },
}));
let mockTransport: jest.Mock<
  ReturnType<typeof fetch>,
  Parameters<typeof fetch>
>;
let mockState: SessionState;
jest.mock("@/features/auth/session-provider", () => ({
  useSession: () => ({ state: mockState, authorisedFetch: mockTransport }),
}));
const mockVoice: CapturedMedia = {
  kind: "voice_note",
  uri: "file:///private-cache/capture/synthetic.m4a",
  mimeType: "audio/mp4",
  sizeBytes: 3,
  durationMs: 12000,
};
const mockPhoto: CapturedMedia = {
  kind: "photo",
  uri: "file:///private-cache/capture/synthetic.jpg",
  mimeType: "image/jpeg",
  sizeBytes: 3,
};
jest.mock("@/features/capture/voice-note", () => ({
  VoiceNoteCapture: ({
    onResult,
  }: {
    onResult: (value: Result<CapturedMedia, CaptureError>) => void;
  }) => {
    const { Button } =
      jest.requireActual<typeof import("react-native")>("react-native");
    return (
      <Button
        title="Synthetic recorded voice"
        onPress={() => {
          onResult({ ok: true, value: mockVoice });
        }}
      />
    );
  },
}));
jest.mock("@/features/capture/camera-capture", () => ({
  CameraCapture: ({
    onResult,
  }: {
    onResult: (value: Result<CapturedMedia, CaptureError>) => void;
  }) => {
    const { Button } =
      jest.requireActual<typeof import("react-native")>("react-native");
    return (
      <Button
        title="Synthetic captured photo"
        onPress={() => {
          onResult({ ok: true, value: mockPhoto });
        }}
      />
    );
  },
}));
jest.mock("expo-audio", () => ({
  useAudioPlayer: () => ({
    play: jest.fn(),
    pause: jest.fn(),
    seekTo: jest.fn(() => Promise.resolve()),
  }),
  useAudioPlayerStatus: () => ({ playing: false, didJustFinish: false }),
}));
let intake: IntakeView;
let units: ReportUnit[];
let getFailure: Response | null;
let confirmFailure: string | null;
let confirmPending: Promise<Response> | null;
let rejectFailure: string | null;
let transportOrder: string[];
function requestBody(init?: RequestInit): unknown {
  return typeof init?.body === "string"
    ? (JSON.parse(init.body) as unknown)
    : {};
}
function pathname(input: Parameters<typeof fetch>[0]): string {
  return new URL(
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url,
  ).pathname;
}
function serve(
  input: Parameters<typeof fetch>[0],
  init?: RequestInit,
): Promise<Response> {
  const path = pathname(input);
  transportOrder.push(path);
  if (path.endsWith("/maintenance/tickets"))
    return Promise.resolve(jsonResponse({ items: [], nextCursor: null }));
  if (path.endsWith("/maintenance/units"))
    return Promise.resolve(jsonResponse({ items: units }));
  if (path.endsWith("/media/uploads")) {
    const body = uploadBodySchema.parse(requestBody(init));
    return Promise.resolve(jsonResponse(syntheticUpload(body.kind), 201));
  }
  if (path.endsWith("/complete"))
    return Promise.resolve(
      jsonResponse({
        media: syntheticMedia(
          path.includes(syntheticId(3)) ? "photo" : "voice_note",
        ),
      }),
    );
  if (path.endsWith("/maintenance/intakes")) {
    const body = intakeBodySchema.parse(requestBody(init));
    intake = { ...intake, language: body.language, typedText: body.typedText };
    return Promise.resolve(jsonResponse({ intake }, 201));
  }
  if (path.endsWith("/confirm")) {
    if (confirmPending) return confirmPending;
    if (confirmFailure === "network")
      return Promise.reject(new TypeError("Synthetic timeout"));
    if (confirmFailure)
      return Promise.resolve(jsonResponse({ code: confirmFailure }, 409));
    const body = confirmIntakeBodySchema.parse(requestBody(init));
    intake = {
      ...intake,
      ...body,
      status: "committed",
      version: intake.version + 1,
      ticketId: syntheticId(5),
    };
    return Promise.resolve(
      jsonResponse({ intake, ticket: syntheticTicket(body) }, 201),
    );
  }
  if (path.endsWith("/reject")) {
    if (rejectFailure === "network")
      return Promise.reject(new TypeError("Synthetic timeout"));
    intake = { ...intake, status: "rejected", version: intake.version + 1 };
    return Promise.resolve(jsonResponse({ intake }));
  }
  return Promise.resolve(getFailure ?? jsonResponse({ intake }));
}
let cache: QueryClient;
beforeEach(() => {
  onlineManager.setOnline(true);
  intake = syntheticIntake();
  units = [
    {
      id: syntheticId(1),
      unitNo: "104",
      propertyName: "Synthetic",
      label: "Synthetic unit 104",
    },
  ];
  getFailure = null;
  confirmFailure = null;
  confirmPending = null;
  rejectFailure = null;
  transportOrder = [];
  mockTransport = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>(
    serve,
  );
  mockState = {
    status: "signed_in",
    account: {
      id: syntheticId(90),
      displayName: "Synthetic tenant",
      locale: "en",
    },
    activeCompanyId: syntheticId(80),
    accessTokenExpiresAt: "2026-09-28T23:00:00Z",
    contexts: [
      {
        companyId: syntheticId(80),
        companyName: { en: "Synthetic", ar: "تجريبي" },
        isDemo: true,
        capacities: ["tenant"],
      },
    ],
  };
  cache = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    },
  });
  jest.spyOn(global, "fetch").mockImplementation((input) => {
    transportOrder.push(pathname(input));
    return Promise.resolve(new Response(null, { status: 200 }));
  });
  jest
    .spyOn(upload, "readCaptureBytes")
    .mockResolvedValue(new Uint8Array([97, 98, 99]));
});
afterEach(() => {
  cache.clear();
  onlineManager.setOnline(true);
  jest.restoreAllMocks();
});
async function mount(node: ReactNode, locale: Locale = "en"): Promise<void> {
  await render(
    <LocaleProvider initialLocale={locale}>
      <QueryClientProvider client={cache}>
        <CaptureProvider>{node}</CaptureProvider>
      </QueryClientProvider>
    </LocaleProvider>,
  );
}
function calls(suffix: string): Parameters<typeof fetch>[] {
  return mockTransport.mock.calls.filter(([url]) =>
    pathname(url).endsWith(suffix),
  );
}
async function review(locale: Locale = "en"): Promise<void> {
  await mount(<ReviewScreen intakeId={intake.id} />, locale);
  await screen.findByTestId("report-transcript");
}
async function confirmed(): Promise<void> {
  await waitFor(() => {
    expect(mockRouter.replace).toHaveBeenCalledWith(
      `/tickets/${syntheticId(5)}`,
    );
  });
}
async function captureBoth(): Promise<void> {
  await fireEvent.press(
    screen.getByRole("button", { name: "Record a voice note" }),
  );
  await fireEvent.press(screen.getByText("Synthetic recorded voice"));
  await fireEvent.press(screen.getByRole("button", { name: "Add photo" }));
  await fireEvent.press(screen.getByText("Synthetic captured photo"));
}
it("AC-3 puts safety first, preselects one unit, gates submission, uploads both captures and navigates", async () => {
  await mount(<ReportScreen />);
  await screen.findByText("Synthetic unit 104");
  expect(screen.getAllByRole("text")[0]).toHaveTextContent(
    getMessages("en").Report.safety,
  );
  expect(screen.getByTestId(`report-unit-${syntheticId(1)}`)).toHaveProp(
    "accessibilityState",
    expect.objectContaining({ selected: true }),
  );
  expect(screen.getByTestId("report-check")).toBeDisabled();
  await captureBoth();
  expect(screen.getByTestId("report-check")).toBeEnabled();
  await fireEvent.press(screen.getByTestId("report-check"));
  await waitFor(() => {
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: "/report/[intakeId]",
      params: { intakeId: intake.id },
    });
  });
  expect(calls("/media/uploads")).toHaveLength(2);
  expect(calls("/complete")).toHaveLength(2);
  expect(requestBody(calls("/maintenance/intakes")[0]?.[1])).toEqual({
    unitId: syntheticId(1),
    language: "en",
    voiceMediaId: syntheticId(2),
    photoMediaIds: [syntheticId(3)],
    typedText: null,
  });
  expect(transportOrder.slice(1)).toEqual([
    `/v1/companies/${syntheticId(80)}/media/uploads`,
    "/voice_note",
    `/v1/companies/${syntheticId(80)}/media/${syntheticId(2)}/complete`,
    `/v1/companies/${syntheticId(80)}/media/uploads`,
    "/photo",
    `/v1/companies/${syntheticId(80)}/media/${syntheticId(3)}/complete`,
    `/v1/companies/${syntheticId(80)}/maintenance/intakes`,
  ]);
  expect(
    cache
      .getQueryCache()
      .getAll()
      .every(
        (query) =>
          query.queryKey[0] === syntheticId(90) &&
          query.queryKey[1] === syntheticId(80),
      ),
  ).toBe(true);
});
it("AC-3 shows no linked unit and requires an explicit choice when several units exist", async () => {
  units = [];
  await mount(<ReportScreen />);
  expect(
    await screen.findByText(getMessages("en").Report.noUnits),
  ).toBeTruthy();
  await fireEvent.changeText(
    screen.getByTestId("report-text"),
    "Synthetic leak",
  );
  expect(screen.getByTestId("report-check")).toBeDisabled();
  units = [
    {
      id: syntheticId(1),
      unitNo: "104",
      propertyName: "Synthetic",
      label: "Synthetic 104",
    },
    {
      id: syntheticId(6),
      unitNo: "105",
      propertyName: "Synthetic",
      label: "Synthetic 105",
    },
  ];
  await act(() => cache.invalidateQueries());
  await screen.findByText("Synthetic 105");
  expect(screen.getByTestId("report-check")).toBeDisabled();
  await fireEvent.press(screen.getByText("Synthetic 105"));
  expect(screen.getByTestId("report-check")).toBeEnabled();
});
it("AC-3 submits text alone with the Arabic interface language and retains it after intake failure", async () => {
  await mount(<ReportScreen />, "ar");
  await screen.findByText("Synthetic unit 104");
  await fireEvent.changeText(
    screen.getByTestId("report-text"),
    "يوجد تسرب ماء",
  );
  const normal = serve;
  let failed = true;
  mockTransport.mockImplementation((input, init) =>
    pathname(input).endsWith("/maintenance/intakes") && failed
      ? Promise.reject(new TypeError("Synthetic timeout"))
      : normal(input, init),
  );
  await fireEvent.press(screen.getByTestId("report-check"));
  await screen.findByText(getMessages("ar").Report.couldNotLoad);
  expect(screen.getByTestId("report-text")).toHaveProp(
    "value",
    "يوجد تسرب ماء",
  );
  failed = false;
  await fireEvent.press(
    screen.getByRole("button", { name: getMessages("ar").Report.retry }),
  );
  await waitFor(() => {
    expect(mockRouter.push).toHaveBeenCalled();
  });
  const attempts = calls("/maintenance/intakes");
  expect(new Headers(attempts[0]?.[1]?.headers).get("Idempotency-Key")).toBe(
    new Headers(attempts[1]?.[1]?.headers).get("Idempotency-Key"),
  );
  expect(requestBody(attempts[1]?.[1])).toMatchObject({
    language: "ar",
    voiceMediaId: null,
    photoMediaIds: [],
    typedText: "يوجد تسرب ماء",
  });
});
it("AC-4 reviews the Arabic transcript and drafted plumbing details before confirming edited text", async () => {
  await review();
  expect(screen.getAllByRole("text")[0]).toHaveTextContent(
    getMessages("en").Report.safety,
  );
  expect(screen.getByTestId("report-transcript")).toHaveProp(
    "value",
    "يوجد تسرب ماء تحت الحوض",
  );
  expect(screen.getByText("Plumbing")).toBeTruthy();
  expect(screen.getByText("Urgent")).toBeTruthy();
  expect(screen.getByText("No safety flag")).toBeTruthy();
  expect(calls("/confirm")).toHaveLength(0);
  await fireEvent.press(screen.getByTestId("drafted-action-edit"));
  await fireEvent.changeText(
    screen.getByTestId("report-transcript"),
    "تسرب ماء تحت حوض المطبخ",
  );
  await fireEvent.press(screen.getByTestId("drafted-action-confirm"));
  await confirmed();
  expect(requestBody(calls("/confirm")[0]?.[1])).toEqual({
    expectedVersion: 1,
    transcript: "تسرب ماء تحت حوض المطبخ",
    description: "تسرب ماء تحت حوض المطبخ",
    category: "plumbing",
    priority: "urgent",
    safetyFlags: [],
  });
});
it.each([403, 404])(
  "AC-5 HTTP %s hides decisions for the wrong role or scope",
  async (status) => {
    getFailure = jsonResponse(
      { code: status === 404 ? "NOT_FOUND" : "NOT_AUTHORISED" },
      status,
    );
    await mount(<ReviewScreen intakeId={intake.id} />);
    expect(
      await screen.findByText("This report is not available to you"),
    ).toBeTruthy();
    expect(screen.queryByTestId("drafted-action-confirm")).toBeNull();
  },
);
it("AC-6 degraded transcription starts empty and requires three non-space characters", async () => {
  intake = syntheticIntake({
    transcription: { mode: "degraded" },
    transcript: "Discard this provider fallback",
  });
  await review();
  expect(screen.getByTestId("report-transcript")).toHaveProp("value", "");
  expect(screen.getByTestId("report-transcript")).toHaveProp("editable", true);
  expect(screen.getByTestId("drafted-action-confirm")).toBeDisabled();
  await fireEvent.changeText(screen.getByTestId("report-transcript"), "ab");
  expect(screen.getByTestId("drafted-action-confirm")).toBeDisabled();
  await fireEvent.changeText(screen.getByTestId("report-transcript"), "abc");
  expect(screen.getByTestId("drafted-action-confirm")).toBeEnabled();
});
it("AC-7 duplicate taps send one request and a timeout retry reuses the same key and payload", async () => {
  let resolve: ((response: Response) => void) | undefined;
  confirmPending = new Promise((done) => {
    resolve = done;
  });
  await review();
  await fireEvent.press(screen.getByTestId("drafted-action-confirm"));
  await fireEvent.press(screen.getByTestId("drafted-action-confirm"));
  expect(calls("/confirm")).toHaveLength(1);
  expect(screen.getByTestId("drafted-action-confirm")).toBeDisabled();
  await act(() => {
    resolve?.(jsonResponse({ code: "could_not_load" }, 503));
  });
  await screen.findByText(getMessages("en").Report.retryDecision);
  confirmPending = null;
  await fireEvent.press(screen.getByTestId("drafted-action-confirm"));
  await confirmed();
  const attempts = calls("/confirm");
  expect(attempts).toHaveLength(2);
  expect(new Headers(attempts[0]?.[1]?.headers).get("Idempotency-Key")).toBe(
    new Headers(attempts[1]?.[1]?.headers).get("Idempotency-Key"),
  );
  expect(requestBody(attempts[0]?.[1])).toEqual(requestBody(attempts[1]?.[1]));
});
it("AC-7 a network failure retains edits and retries confirmation with the same command key", async () => {
  confirmFailure = "network";
  await review();
  await fireEvent.press(screen.getByTestId("drafted-action-edit"));
  await fireEvent.changeText(
    screen.getByTestId("report-transcript"),
    "Edited synthetic leak",
  );
  await fireEvent.press(screen.getByTestId("drafted-action-confirm"));
  await screen.findByText(getMessages("en").Report.couldNotLoad);
  expect(screen.getByTestId("report-transcript")).toHaveProp(
    "value",
    "Edited synthetic leak",
  );
  confirmFailure = null;
  await fireEvent.press(screen.getByRole("button", { name: "Retry" }));
  await confirmed();
  const attempts = calls("/confirm");
  expect(new Headers(attempts[0]?.[1]?.headers).get("Idempotency-Key")).toBe(
    new Headers(attempts[1]?.[1]?.headers).get("Idempotency-Key"),
  );
});
it("AC-8 stale version reloads current details and preserves the tenant's edited transcript", async () => {
  confirmFailure = "STALE_VERSION";
  await review();
  await fireEvent.press(screen.getByTestId("drafted-action-edit"));
  await fireEvent.changeText(
    screen.getByTestId("report-transcript"),
    "My retained edit",
  );
  intake = {
    ...intake,
    version: 2,
    priority: "routine",
    transcript: "Changed on server",
  };
  await fireEvent.press(screen.getByTestId("drafted-action-confirm"));
  await screen.findByText("Routine");
  expect(screen.getByTestId("report-transcript")).toHaveProp(
    "value",
    "My retained edit",
  );
  expect(calls(`/maintenance/intakes/${intake.id}`)).toHaveLength(2);
  confirmFailure = null;
  await fireEvent.press(screen.getByTestId("drafted-action-confirm"));
  await confirmed();
  expect(requestBody(calls("/confirm")[1]?.[1])).toMatchObject({
    expectedVersion: 2,
    transcript: "My retained edit",
    priority: "routine",
  });
});
it("AC-8 expired draft shows Report again and removes confirmation", async () => {
  confirmFailure = "EXPIRED";
  await review();
  await fireEvent.press(screen.getByTestId("drafted-action-confirm"));
  await screen.findByText("This draft expired. Report again.");
  expect(screen.queryByTestId("drafted-action-confirm")).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Report again" }));
  expect(mockRouter.replace).toHaveBeenCalledWith("/report");
});
it("AC-8 already decided reloads and announces the current committed status", async () => {
  confirmFailure = "ALREADY_DECIDED";
  await review();
  intake = {
    ...intake,
    status: "committed",
    version: 2,
    ticketId: syntheticId(5),
  };
  await fireEvent.press(screen.getByTestId("drafted-action-confirm"));
  expect(
    await screen.findByText(
      "This draft has already been decided. Current status: Confirmed.",
    ),
  ).toBeTruthy();
  expect(screen.queryByTestId("drafted-action-confirm")).toBeNull();
});
it("AC-9 degraded triage leaves category and priority for the manager", async () => {
  intake = syntheticIntake({ triage: { mode: "degraded", confidence: null } });
  await review();
  expect(
    screen.getAllByText("The manager will set the category and priority."),
  ).toHaveLength(2);
});
it("AC-10 discard rejects with a null reason and returns to maintenance", async () => {
  await review();
  await fireEvent.press(screen.getByTestId("drafted-action-discard"));
  await waitFor(() => {
    expect(mockRouter.replace).toHaveBeenCalledWith("/tenant/maintenance");
  });
  expect(requestBody(calls("/reject")[0]?.[1])).toEqual({
    expectedVersion: 1,
    reason: null,
  });
  expect(calls("/confirm")).toHaveLength(0);
});
it("AC-11 Arabic review uses Arabic safety and send labels with RTL layout", async () => {
  await review("ar");
  expect(screen.getByText(getMessages("ar").Report.safety)).toBeTruthy();
  expect(screen.getByText("السباكة")).toBeTruthy();
  expect(screen.getByText("عاجل")).toBeTruthy();
  expect(screen.getByText("مقترح بالذكاء الاصطناعي")).toBeTruthy();
  expect(screen.getByRole("button", { name: "إرسال البلاغ" })).toBeTruthy();
  expect(screen.getByTestId("report-review")).toHaveStyle({ direction: "rtl" });
  expect(screen.getByTestId("report-transcript")).toHaveStyle({
    writingDirection: "rtl",
  });
});
it("AC-12 Report and Maintenance catalogues have identical nested key paths", () => {
  function paths(value: object, prefix = ""): string[] {
    return Object.entries(value)
      .flatMap(([key, child]: [string, unknown]) =>
        typeof child === "object" && child !== null
          ? paths(child, `${prefix}${key}.`)
          : [`${prefix}${key}`],
      )
      .sort();
  }
  for (const namespace of ["Report", "Maintenance"] as const)
    expect(paths(getMessages("en")[namespace])).toEqual(
      paths(getMessages("ar")[namespace]),
    );
});
it("AC-13 maintenance shows one primary report action and the empty state", async () => {
  await mount(<MaintenanceScreen />);
  expect(screen.getByText("Maintenance")).toBeTruthy();
  expect(await screen.findByText("No reports yet")).toBeTruthy();
  await fireEvent.press(
    screen.getByRole("button", { name: "Report a problem" }),
  );
  expect(mockRouter.push).toHaveBeenCalledWith("/report");
  expect(screen.getAllByRole("button")).toHaveLength(2);
});
it("keeps text and both captures while offline and blocks sending", async () => {
  await mount(<ReportScreen />);
  await screen.findByText("Synthetic unit 104");
  await captureBoth();
  await fireEvent.changeText(
    screen.getByTestId("report-text"),
    "Retained input",
  );
  await act(() => {
    onlineManager.setOnline(false);
  });
  expect(screen.getByText(getMessages("en").Report.offline)).toBeTruthy();
  expect(screen.getByTestId("report-check")).toBeDisabled();
  expect(screen.getByTestId("report-text")).toHaveProp(
    "value",
    "Retained input",
  );
  expect(screen.getByLabelText("Photo 1")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Play voice note" })).toBeTruthy();
  expect(calls("/maintenance/intakes")).toHaveLength(0);
});

it("announces upload progress and analysis without losing either capture on a failed PUT", async () => {
  let finishPut: ((response: Response) => void) | undefined;
  jest.mocked(global.fetch).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishPut = resolve;
      }),
  );
  await mount(<ReportScreen />);
  await screen.findByText("Synthetic unit 104");
  await captureBoth();
  await fireEvent.press(screen.getByTestId("report-check"));
  expect(await screen.findByText("Uploading 0 of 2")).toBeTruthy();
  await act(() => {
    finishPut?.(new Response(null, { status: 500 }));
  });
  await screen.findByText(getMessages("en").Report.uploadFailed);
  expect(screen.getByLabelText("Photo 1")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Play voice note" })).toBeTruthy();
  let finishIntake: ((response: Response) => void) | undefined;
  mockTransport.mockImplementation((input, init) =>
    pathname(input).endsWith("/maintenance/intakes")
      ? new Promise((resolve) => {
          finishIntake = resolve;
        })
      : serve(input, init),
  );
  await fireEvent.press(screen.getByRole("button", { name: "Retry" }));
  await screen.findByText("Checking your report");
  expect(screen.getByTestId("report-check")).toBeDisabled();
  await act(() => {
    finishIntake?.(jsonResponse({ intake }, 201));
  });
  expect(mockRouter.push).toHaveBeenCalled();
});
it("a failed initial load offers retry beside the error and then shows the draft", async () => {
  getFailure = jsonResponse({ code: "UNKNOWN" }, 503);
  await mount(<ReviewScreen intakeId={intake.id} />);
  await screen.findByText(getMessages("en").Report.couldNotLoad);
  getFailure = null;
  await fireEvent.press(screen.getByRole("button", { name: "Retry" }));
  await screen.findByTestId("report-transcript");
  expect(screen.getByTestId("drafted-action-confirm")).toBeEnabled();
});
it("retries discard after a network failure with its original key and never confirms", async () => {
  rejectFailure = "network";
  await review();
  await fireEvent.press(screen.getByTestId("drafted-action-discard"));
  await screen.findByText(getMessages("en").Report.couldNotLoad);
  expect(screen.getByTestId("drafted-action-confirm")).toBeDisabled();
  rejectFailure = null;
  await fireEvent.press(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() => {
    expect(mockRouter.replace).toHaveBeenCalledWith("/tenant/maintenance");
  });
  const attempts = calls("/reject");
  expect(attempts).toHaveLength(2);
  expect(new Headers(attempts[0]?.[1]?.headers).get("Idempotency-Key")).toBe(
    new Headers(attempts[1]?.[1]?.headers).get("Idempotency-Key"),
  );
  expect(calls("/confirm")).toHaveLength(0);
});
it("does not navigate or publish retained media when a late intake crosses a company change", async () => {
  let finish: ((response: Response) => void) | undefined;
  mockTransport.mockImplementation((input, init) =>
    pathname(input).endsWith("/maintenance/intakes")
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : serve(input, init),
  );
  await mount(<ReportScreen />);
  await screen.findByText("Synthetic unit 104");
  await fireEvent.changeText(
    screen.getByTestId("report-text"),
    "Synthetic leak",
  );
  await fireEvent.press(screen.getByTestId("report-check"));
  await screen.findByText("Checking your report");
  await act(() =>
    emitSessionEvent({
      type: "context_changed",
      accountId: syntheticId(90),
      previousCompanyId: syntheticId(80),
      companyId: syntheticId(81),
    }),
  );
  await act(() => {
    finish?.(jsonResponse({ intake }, 201));
  });
  expect(mockRouter.push).not.toHaveBeenCalled();
  expect(
    cache.getQueryData([
      syntheticId(90),
      syntheticId(80),
      "report",
      "captures",
      intake.id,
    ]),
  ).toBeUndefined();
});
it("does not navigate after a late discard response crosses sign-out", async () => {
  let finish: ((response: Response) => void) | undefined;
  mockTransport.mockImplementation((input, init) =>
    pathname(input).endsWith("/reject")
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : serve(input, init),
  );
  await review();
  await fireEvent.press(screen.getByTestId("drafted-action-discard"));
  await act(() =>
    emitSessionEvent({
      type: "signed_out",
      accountId: syntheticId(90),
      previousCompanyId: syntheticId(80),
      companyId: null,
    }),
  );
  await act(() => {
    finish?.(
      jsonResponse({ intake: { ...intake, status: "rejected", version: 2 } }),
    );
  });
  expect(mockRouter.replace).not.toHaveBeenCalled();
});

it("preserves a long transcript and confirms its separately edited short ticket description", async () => {
  const transcript = "Synthetic long transcript. ".repeat(80);
  intake = syntheticIntake({
    transcript,
    description: "Synthetic drafted summary",
  });
  await review();
  expect(screen.getByTestId("report-transcript")).toHaveProp(
    "value",
    transcript,
  );
  expect(screen.getByTestId("report-ticket-description")).toHaveProp(
    "value",
    "Synthetic drafted summary",
  );
  expect(screen.getByTestId("drafted-action-confirm")).toBeEnabled();
  await fireEvent.press(screen.getByTestId("drafted-action-edit"));
  await fireEvent.changeText(
    screen.getByTestId("report-ticket-description"),
    "My edited short description",
  );
  await fireEvent.press(screen.getByTestId("drafted-action-confirm"));
  await confirmed();
  expect(requestBody(calls("/confirm")[0]?.[1])).toMatchObject({
    transcript,
    description: "My edited short description",
  });
});
it("uses the three-character minimum only for degraded transcription", async () => {
  intake = syntheticIntake({ transcript: "AC", description: "AC" });
  await review();
  expect(screen.getByTestId("drafted-action-confirm")).toBeEnabled();
});

it("AC-8 replaces review with ticket detail and invalidates only the scoped ticket list", async () => {
  const key = [syntheticId(90), syntheticId(80), "maintenance", "tickets"];
  const other = [syntheticId(90), syntheticId(81), "maintenance", "tickets"];
  cache.setQueryData(key, {
    pages: [{ items: [], nextCursor: null }],
    pageParams: [undefined],
  });
  cache.setQueryData(other, {
    pages: [{ items: [], nextCursor: null }],
    pageParams: [undefined],
  });
  await review();
  await fireEvent.press(screen.getByTestId("drafted-action-confirm"));
  await confirmed();
  expect(cache.getQueryState(key)?.isInvalidated).toBe(true);
  expect(cache.getQueryState(other)?.isInvalidated).toBe(false);
});

it("does not navigate or invalidate another scope after a late confirmation", async () => {
  let finish: ((response: Response) => void) | undefined;
  confirmPending = new Promise((resolve) => {
    finish = resolve;
  });
  const key = [syntheticId(90), syntheticId(81), "maintenance", "tickets"];
  cache.setQueryData(key, {
    pages: [{ items: [], nextCursor: null }],
    pageParams: [undefined],
  });
  await review();
  await fireEvent.press(screen.getByTestId("drafted-action-confirm"));
  await act(() =>
    emitSessionEvent({
      type: "context_changed",
      accountId: syntheticId(90),
      previousCompanyId: syntheticId(80),
      companyId: syntheticId(81),
    }),
  );
  await act(() => {
    finish?.(
      jsonResponse(
        {
          intake: { ...intake, status: "committed", ticketId: syntheticId(5) },
          ticket: syntheticTicket(),
        },
        201,
      ),
    );
  });
  expect(mockRouter.replace).not.toHaveBeenCalled();
  expect(cache.getQueryState(key)?.isInvalidated).toBe(false);
});
