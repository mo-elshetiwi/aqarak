import { parseConfig } from "./config";

describe("AC-16 startup configuration", () => {
  it("defaults to the fixture adapter", () => {
    expect(parseConfig(undefined, undefined, false).adapter).toBe("fixture");
  });
  it.each([
    "",
    "ftp://example.com",
    "http://example.com",
    "https://user:pass@example.com",
    "https://example.com/?secret=abc",
  ])("rejects an unsafe HTTP base URL", (url) => {
    expect(() => parseConfig("http", url, false)).toThrow(
      "EXPO_PUBLIC_API_BASE_URL",
    );
  });
  it("names an unknown adapter variable", () => {
    expect(() => parseConfig("unknown", "", true)).toThrow(
      "EXPO_PUBLIC_AUTH_ADAPTER",
    );
  });
  it("allows HTTPS and development loopback only", () => {
    expect(parseConfig("http", "https://example.com/", false).baseUrl).toBe(
      "https://example.com",
    );
    expect(parseConfig("http", "http://10.0.2.2:3000", true).adapter).toBe(
      "http",
    );
    expect(() => parseConfig("http", "http://localhost:3000", false)).toThrow();
  });
});
