import type { ReactNode } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react-native";
import {
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { getMessages, type Locale } from "@aqarak/i18n";
import { LocaleProvider } from "@/features/locale/locale-provider";
import type { SessionState } from "@/features/auth/session";
import {
  ticketStatusSchema,
  type TicketView,
} from "@/features/report/contract";
import {
  jsonResponse,
  syntheticId,
  syntheticTicket,
} from "@/features/report/test-support";
import { TicketsScreen } from "./list-screen";
import { TicketDetailScreen } from "./detail-screen";

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
let cache: QueryClient;
let tickets: TicketView[];
let failure: number | null;
let nextCursor: string | null;
let ticket: TicketView;
let photoFailure: boolean;
const photoUrl = "https://objects.example.test/photo?signature=synthetic";
function url(input: Parameters<typeof fetch>[0]): URL {
  return new URL(
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url,
  );
}
function serve(input: Parameters<typeof fetch>[0]): Promise<Response> {
  if (failure)
    return Promise.resolve(jsonResponse({ code: "FAILURE" }, failure));
  const request = url(input);
  if (request.pathname.endsWith("/download"))
    return Promise.resolve(
      photoFailure
        ? jsonResponse({ code: "UPLOAD_NOT_READY" }, 409)
        : jsonResponse({ url: photoUrl, expiresAt: "2099-09-28T06:00:00Z" }),
    );
  if (request.pathname.endsWith(`/tickets/${ticket.id}`))
    return Promise.resolve(jsonResponse({ ticket }));
  if (request.searchParams.has("cursor"))
    return Promise.resolve(
      jsonResponse({ items: [tickets[0]], nextCursor: null }),
    );
  return Promise.resolve(jsonResponse({ items: tickets, nextCursor }));
}
beforeEach(() => {
  jest.useFakeTimers();
  onlineManager.setOnline(true);
  tickets = [syntheticTicket()];
  ticket = syntheticTicket();
  photoFailure = false;
  failure = null;
  nextCursor = null;
  mockTransport = jest.fn(serve);
  mockState = {
    status: "signed_in",
    account: {
      id: syntheticId(90),
      displayName: "Synthetic tenant",
      locale: "en",
    },
    activeCompanyId: syntheticId(80),
    accessTokenExpiresAt: "2099-09-28T23:00:00Z",
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
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
});
afterEach(async () => {
  await cleanup();
  cache.clear();
  onlineManager.setOnline(true);
  jest.restoreAllMocks();
  jest.useRealTimers();
});
async function mount(
  node: ReactNode = <TicketsScreen />,
  locale: Locale = "en",
): Promise<void> {
  await render(
    <LocaleProvider initialLocale={locale}>
      <QueryClientProvider client={cache}>{node}</QueryClientProvider>
    </LocaleProvider>,
  );
}

it("AC-1 lists all returned tickets newest first with selected fields and 48 dp rows", async () => {
  tickets = [
    {
      ...syntheticTicket(),
      id: syntheticId(6),
      category: "ac",
      createdAt: "2026-09-20T06:00:00Z",
      reportedByMe: false,
    },
    syntheticTicket(),
  ];
  await mount();
  await screen.findByText("Plumbing");
  const rows = screen.getAllByRole("link");
  expect(rows.map((row) => row.props.testID as string)).toEqual([
    `ticket-row-${syntheticId(5)}`,
    `ticket-row-${syntheticId(6)}`,
  ]);
  for (const row of rows) expect(row).toHaveStyle({ minHeight: 48 });
  const newest = within(screen.getByTestId(`ticket-row-${syntheticId(5)}`));
  expect(newest.getByText("Plumbing")).toBeTruthy();
  expect(newest.getByText("Synthetic unit 104")).toBeTruthy();
  expect(newest.getByText("Reported")).toBeTruthy();
  expect(newest.getByText("Urgent")).toBeTruthy();
  expect(newest.getByText("Reported 28/09/2026")).toHaveStyle({
    fontVariant: ["tabular-nums"],
  });
  expect(
    screen.queryByText(syntheticTicket().transcript ?? "missing"),
  ).toBeNull();
  expect(
    screen
      .getAllByRole("button")
      .filter((button) =>
        String(button.props.className).split(" ").includes("bg-primary"),
      ),
  ).toHaveLength(1);
  await fireEvent.press(screen.getByTestId(`ticket-row-${syntheticId(5)}`));
  expect(mockRouter.push).toHaveBeenCalledWith(`/tickets/${syntheticId(5)}`);
  await fireEvent.press(
    screen.getByRole("button", { name: "Report a problem" }),
  );
  expect(mockRouter.push).toHaveBeenCalledWith("/report");
  expect(
    cache.getQueryData([
      syntheticId(90),
      syntheticId(80),
      "maintenance",
      "tickets",
    ]),
  ).toBeDefined();
});
it("AC-2 shows the empty sentence and one report action", async () => {
  tickets = [];
  await mount();
  expect(await screen.findByText("No reports yet")).toBeTruthy();
  expect(
    screen.getAllByRole("button", { name: "Report a problem" }),
  ).toHaveLength(1);
});
it("AC-3 keeps retry beside the failure and refetches on demand", async () => {
  failure = 500;
  await mount();
  await screen.findByText("Could not load reports.");
  const recovery = within(screen.getByTestId("ticket-failure"));
  expect(recovery.getByText("Could not load reports.")).toBeTruthy();
  expect(mockTransport).toHaveBeenCalledTimes(1);
  failure = null;
  await fireEvent.press(recovery.getByRole("button", { name: "Try again" }));
  expect(await screen.findByText("Plumbing")).toBeTruthy();
  expect(mockTransport).toHaveBeenCalledTimes(2);
});
it("AC-4 requests the next cursor and retains the first page", async () => {
  nextCursor = "next+/=";
  await mount();
  await screen.findByText("Plumbing");
  tickets = [{ ...syntheticTicket(), id: syntheticId(6), category: "ac" }];
  await fireEvent.press(screen.getByRole("button", { name: "Load more" }));
  expect(await screen.findByText("Air conditioning")).toBeTruthy();
  expect(screen.getByText("Plumbing")).toBeTruthy();
  expect(
    url(
      mockTransport.mock.calls[1]?.[0] ?? "https://missing.test",
    ).searchParams.get("cursor"),
  ).toBe("next+/=");
  expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
});
it.each([403, 404])(
  "AC-6 hides unavailable list data for HTTP %s without retry",
  async (status) => {
    failure = status;
    await mount();
    expect(
      await screen.findByText("This report is not available to you"),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(mockTransport).toHaveBeenCalledTimes(1);
  },
);
it("AC-9 renders the list in Arabic with RTL and readable body text", async () => {
  await mount(<TicketsScreen />, "ar");
  expect(await screen.findByText("السباكة")).toBeTruthy();
  expect(screen.getByText("الصيانة")).toBeTruthy();
  expect(screen.getByText("تم الإبلاغ في 28/09/2026")).toHaveStyle({
    writingDirection: "rtl",
    fontSize: 17,
  });
  expect(screen.getByTestId("tickets-screen")).toHaveStyle({
    direction: "rtl",
  });
});
it("AC-10 keeps all maintenance catalogue paths identical", () => {
  function paths(value: object, prefix = ""): string[] {
    return Object.entries(value)
      .flatMap(([key, child]: [string, unknown]) =>
        typeof child === "object" && child !== null
          ? paths(child, `${prefix}${key}.`)
          : [`${prefix}${key}`],
      )
      .sort();
  }
  expect(paths(getMessages("en").Maintenance)).toEqual(
    paths(getMessages("ar").Maintenance),
  );
});
it("shows skeletons while loading and refreshes without dropping cached rows", async () => {
  let finish: ((value: Response) => void) | undefined;
  mockTransport.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await mount();
  expect(screen.getByTestId("skeleton-compact")).toBeTruthy();
  expect(screen.getByTestId("skeleton-expanded")).toBeTruthy();
  await act(() => {
    finish?.(jsonResponse({ items: tickets, nextCursor: null }));
  });
  await screen.findByText("Plumbing");
  await fireEvent(screen.getByTestId("tickets-list"), "refresh");
  await waitFor(() => {
    expect(mockTransport).toHaveBeenCalledTimes(2);
  });
  expect(screen.getByText("Plumbing")).toBeTruthy();
});
it("distinguishes offline with and without cached data", async () => {
  await mount();
  await screen.findByText("Plumbing");
  await act(() => {
    onlineManager.setOnline(false);
  });
  expect(screen.getByText(getMessages("en").Maintenance.offline)).toBeTruthy();
  expect(screen.getByText("Plumbing")).toBeTruthy();
  await fireEvent(screen.getByTestId("tickets-list"), "refresh");
  expect(mockTransport).toHaveBeenCalledTimes(1);
});
it("does not announce an empty list or loading when offline before the first fetch", async () => {
  onlineManager.setOnline(false);
  await mount();
  expect(screen.getByText(getMessages("en").Maintenance.offline)).toBeTruthy();
  expect(screen.queryByText("No reports yet")).toBeNull();
  expect(screen.queryByTestId("skeleton-compact")).toBeNull();
  expect(mockTransport).not.toHaveBeenCalled();
});

it("AC-5 shows the detail hierarchy, transcript, danger flag and a plain image source", async () => {
  ticket = {
    ...ticket,
    safetyFlags: ["water_into_electrics"],
    safetyCritical: true,
    description: "Synthetic leak summary",
  };
  await mount(<TicketDetailScreen ticketId={ticket.id} />);
  await screen.findByRole("image", { name: "Photo 1" });
  const identity = within(screen.getByTestId("ticket-identity"));
  expect(identity.getByText("Plumbing")).toBeTruthy();
  expect(identity.getByText("Synthetic unit 104")).toBeTruthy();
  expect(identity.getByText("Reported")).toBeTruthy();
  expect(identity.getByText("What happens next")).toBeTruthy();
  expect(identity.getByText("Next: Office")).toBeTruthy();
  expect(
    identity.getByText("The office reviews the category and priority."),
  ).toBeTruthy();
  expect(screen.getByText("Your words")).toBeTruthy();
  expect(screen.getByText("يوجد تسرب ماء تحت الحوض")).toBeTruthy();
  expect(screen.getByText("Synthetic leak summary")).toBeTruthy();
  expect(screen.getByTestId("safety-flag-water_into_electrics")).toHaveProp(
    "className",
    expect.stringContaining("bg-status-danger-bg"),
  );
  expect(screen.getByText("Water near electrics")).toHaveProp(
    "className",
    expect.stringContaining("text-status-danger-fg"),
  );
  expect(screen.getByRole("image", { name: "Photo 1" })).toHaveProp("source", {
    uri: photoUrl,
  });
  expect(screen.getByText("Voice note, 0:12")).toBeTruthy();
  expect(
    mockTransport.mock.calls.map(([input]) => url(input).pathname),
  ).toEqual([
    `/v1/companies/${syntheticId(80)}/maintenance/tickets/${ticket.id}`,
    `/v1/companies/${syntheticId(80)}/media/${syntheticId(3)}/download`,
  ]);
  expect(
    screen.getAllByRole("header").map((node) => node.props.children as string),
  ).toEqual([
    "Plumbing",
    "What happens next",
    "Your words",
    "Description",
    "Safety",
    "Photos",
  ]);
});
it.each([403, 404])(
  "AC-6 detail HTTP %s is unavailable without retry or photo requests",
  async (status) => {
    failure = status;
    await mount(<TicketDetailScreen ticketId={ticket.id} />);
    expect(
      await screen.findByText("This report is not available to you"),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(screen.queryByText("Plumbing")).toBeNull();
    expect(mockTransport).toHaveBeenCalledTimes(1);
  },
);
it("AC-7 a failed photo link leaves the report visible with a neutral placeholder", async () => {
  photoFailure = true;
  await mount(<TicketDetailScreen ticketId={ticket.id} />);
  expect(await screen.findByText("Photo unavailable")).toBeTruthy();
  expect(
    screen.getByText("The office reviews the category and priority."),
  ).toBeTruthy();
  expect(screen.queryByText("Could not load reports.")).toBeNull();
  expect(screen.queryByRole("image")).toBeNull();
  expect(mockTransport).toHaveBeenCalledTimes(2);
});
it("replaces a failed image with the same neutral placeholder", async () => {
  await mount(<TicketDetailScreen ticketId={ticket.id} />);
  const photo = await screen.findByRole("image", { name: "Photo 1" });
  await fireEvent(photo, "error", {
    nativeEvent: { error: "Synthetic image failure" },
  });
  expect(screen.getByText("Photo unavailable")).toBeTruthy();
  expect(screen.getByText("Plumbing")).toBeTruthy();
  expect(screen.queryByRole("image")).toBeNull();
});
it("AC-9 renders Arabic detail, next step and labels in RTL", async () => {
  await mount(<TicketDetailScreen ticketId={ticket.id} />, "ar");
  expect(
    await screen.findByText("يراجع المكتب التصنيف والأولوية."),
  ).toBeTruthy();
  expect(screen.getByText("الخطوة التالية لدى: المكتب")).toBeTruthy();
  expect(screen.getByText("كلماتك")).toBeTruthy();
  expect(screen.getByText("الوصف")).toBeTruthy();
  expect(screen.getByText("ملاحظة صوتية، 0:12")).toHaveStyle({
    writingDirection: "rtl",
    fontSize: 17,
  });
  expect(screen.getByTestId("ticket-detail")).toHaveStyle({ direction: "rtl" });
  await screen.findByRole("image", { name: "الصورة 1" });
});
it.each(ticketStatusSchema.options)(
  "shows next-step copy and responsibility for %s",
  async (status) => {
    ticket = { ...ticket, status, media: [] };
    await mount(<TicketDetailScreen ticketId={ticket.id} />);
    expect(
      await screen.findByText(getMessages("en").Maintenance.nextStep[status]),
    ).toBeTruthy();
    expect(
      within(screen.getByTestId("ticket-identity")).getByText(
        getMessages("en").Maintenance.status[status],
      ),
    ).toBeTruthy();
    const actors = {
      reported: "Office",
      triaged: "Office",
      awaiting_quote: "Office",
      awaiting_cost_approval: "Owner",
      scheduled: "Technician",
      in_progress: "Technician",
      on_hold: "Office",
      work_completed: "You",
      closed: "No further action",
      cancelled: "No further action",
    };
    expect(screen.getByText(`Next: ${actors[status]}`)).toBeTruthy();
  },
);
it("shows skeletons for detail loading, then honest empty optional sections", async () => {
  ticket = {
    ...ticket,
    transcript: null,
    description: null,
    safetyFlags: [],
    media: [],
  };
  let finish: ((response: Response) => void) | undefined;
  mockTransport.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await mount(<TicketDetailScreen ticketId={ticket.id} />);
  expect(screen.getByTestId("skeleton-compact")).toBeTruthy();
  await act(() => {
    finish?.(jsonResponse({ ticket }));
  });
  expect(await screen.findAllByText("Not provided")).toHaveLength(2);
  expect(screen.getByText("No safety flags reported")).toBeTruthy();
  expect(screen.getByText("No photos attached")).toBeTruthy();
});
it("keeps detail data while offline and hides loading for an uncached offline visit", async () => {
  ticket = { ...ticket, media: [] };
  await mount(<TicketDetailScreen ticketId={ticket.id} />);
  await screen.findByText("Plumbing");
  await act(() => {
    onlineManager.setOnline(false);
  });
  expect(screen.getByText(getMessages("en").Maintenance.offline)).toBeTruthy();
  expect(screen.getByText("Plumbing")).toBeTruthy();
  await screen.unmount();
  cache.clear();
  await mount(<TicketDetailScreen ticketId={ticket.id} />);
  expect(screen.getByText(getMessages("en").Maintenance.offline)).toBeTruthy();
  expect(screen.queryByTestId("skeleton-compact")).toBeNull();
  expect(screen.queryByText("Plumbing")).toBeNull();
  expect(mockTransport).toHaveBeenCalledTimes(1);
});
it("offers adjacent detail retry after a 500 and loads the ticket", async () => {
  failure = 500;
  await mount(<TicketDetailScreen ticketId={ticket.id} />);
  await screen.findByText("Could not load reports.");
  failure = null;
  await fireEvent.press(
    within(screen.getByTestId("ticket-failure")).getByRole("button", {
      name: "Try again",
    }),
  );
  expect(await screen.findByText("Plumbing")).toBeTruthy();
  await screen.findByRole("image", { name: "Photo 1" });
});
it("hides a previously cached ticket when a fresh scope response is forbidden", async () => {
  cache.setQueryData(
    [syntheticId(90), syntheticId(80), "maintenance", "ticket", ticket.id],
    ticket,
  );
  failure = 403;
  await mount(<TicketDetailScreen ticketId={ticket.id} />);
  await screen.findByText("This report is not available to you");
  expect(screen.queryByText("Plumbing")).toBeNull();
  expect(screen.queryByRole("image")).toBeNull();
});
it("obtains a fresh signed link on each detail visit", async () => {
  await mount(<TicketDetailScreen ticketId={ticket.id} />);
  await screen.findByRole("image", { name: "Photo 1" });
  await screen.unmount();
  await mount(<TicketDetailScreen ticketId={ticket.id} />);
  await screen.findByRole("image", { name: "Photo 1" });
  expect(
    mockTransport.mock.calls.filter(([input]) =>
      url(input).pathname.endsWith("/download"),
    ),
  ).toHaveLength(2);
});
it("never presents an already expired download link as an image", async () => {
  mockTransport.mockImplementation((input) =>
    url(input).pathname.endsWith("/download")
      ? Promise.resolve(
          jsonResponse({ url: photoUrl, expiresAt: "2000-01-01T00:00:00Z" }),
        )
      : serve(input),
  );
  await mount(<TicketDetailScreen ticketId={ticket.id} />);
  expect(await screen.findByText("Photo unavailable")).toBeTruthy();
  expect(screen.queryByRole("image")).toBeNull();
});
it.each(["INVALID_REQUEST", "UPLOAD_ALREADY_COMPLETED", "UPLOAD_NOT_READY"])(
  "maps %s to the translated recovery message",
  async (code) => {
    mockTransport.mockResolvedValueOnce(
      jsonResponse({ code }, code === "INVALID_REQUEST" ? 400 : 409),
    );
    await mount();
    expect(
      await screen.findByText(
        code === "INVALID_REQUEST"
          ? "Check the report details and try again."
          : "Could not load reports.",
      ),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  },
);

it("renders Arabic empty and offline list states", async () => {
  tickets = [];
  await mount(<TicketsScreen />, "ar");
  expect(
    await screen.findByText(getMessages("ar").Maintenance.empty),
  ).toBeTruthy();
  expect(
    screen.getByRole("button", { name: getMessages("ar").Maintenance.report }),
  ).toBeTruthy();
  await act(() => {
    onlineManager.setOnline(false);
  });
  expect(screen.getByText(getMessages("ar").Maintenance.offline)).toBeTruthy();
});
it.each([500, 404])(
  "renders Arabic detail failure %s with the appropriate recovery",
  async (status) => {
    failure = status;
    await mount(<TicketDetailScreen ticketId={ticket.id} />, "ar");
    const messages = getMessages("ar").Maintenance;
    expect(
      await screen.findByText(
        status === 404 ? messages.unavailable : messages.couldNotLoad,
      ),
    ).toBeTruthy();
    expect(
      Boolean(screen.queryByRole("button", { name: messages.retry })),
    ).toBe(status === 500);
  },
);
it("renders the Arabic neutral photo placeholder", async () => {
  photoFailure = true;
  await mount(<TicketDetailScreen ticketId={ticket.id} />, "ar");
  expect(
    await screen.findByText(getMessages("ar").Maintenance.photoUnavailable),
  ).toBeTruthy();
  expect(
    screen.getByText(getMessages("ar").Maintenance.nextStep.reported),
  ).toBeTruthy();
});
