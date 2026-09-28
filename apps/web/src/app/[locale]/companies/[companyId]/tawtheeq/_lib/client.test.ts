import { afterEach, describe, expect, it, vi } from "vitest";
const { http, mock, identityIsMock } = vi.hoisted(() => ({
  http: vi.fn(),
  mock: vi.fn(),
  identityIsMock: vi.fn<() => boolean>(),
}));
vi.mock("server-only", () => ({}));
vi.mock("./http-client", () => ({ createHttpClient: http }));
vi.mock("./mock-client", () => ({ createMockClient: mock }));
vi.mock("@/lib/api", () => ({ isMockApi: identityIsMock }));
import { getTawtheeqClient, workflowIsMock } from "./client";
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
describe("workflow transport selection", () => {
  it("uses HTTP workflow with mock identity when explicitly configured", () => {
    identityIsMock.mockReturnValue(true);
    vi.stubEnv("AQARAK_WORKFLOW_API_MODE", "http");
    vi.stubEnv("AQARAK_API_BASE_URL", "http://127.0.0.1:4000");
    getTawtheeqClient("company", "session");
    expect(http).toHaveBeenCalledWith(
      "http://127.0.0.1:4000",
      "company",
      "session",
    );
    expect(mock).not.toHaveBeenCalled();
  });
  it.each([true, false])(
    "inherits identity adapter mode %s when workflow mode is unset",
    (mode) => {
      vi.stubEnv("AQARAK_WORKFLOW_API_MODE", undefined);
      identityIsMock.mockReturnValue(mode);
      expect(workflowIsMock()).toBe(mode);
    },
  );
  it("selects explicit mock at call time and rejects malformed configuration", () => {
    vi.stubEnv("AQARAK_WORKFLOW_API_MODE", "mock");
    getTawtheeqClient("company", "session");
    expect(mock).toHaveBeenCalledWith("company", "session");
    vi.stubEnv("AQARAK_WORKFLOW_API_MODE", "invalid");
    expect(workflowIsMock).toThrow("Invalid workflow API mode");
  });
  it.each([
    "http://public.example",
    "https://user:secret@example.com",
    "https://example.com/?query=1",
  ])("refuses unsafe base URL %s", (url) => {
    vi.stubEnv("AQARAK_WORKFLOW_API_MODE", "http");
    vi.stubEnv("AQARAK_API_BASE_URL", url);
    expect(() => getTawtheeqClient("company", "session")).toThrow(
      "Invalid workflow API URL",
    );
  });
});
