import { authenticateRequest } from "../../identity/adapters";
export type Authenticate = (
  request: Request,
) => Promise<{ accountId: string } | null>;
export const authenticateIdentity: Authenticate = authenticateRequest;
export function requestChannel(request: Request): "web_form" | "mobile_form" {
  return request.headers.get("X-Aqarak-Channel") === "mobile"
    ? "mobile_form"
    : "web_form";
}
export function traceId(request: Request): string | null {
  const match = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/.exec(
    request.headers.get("traceparent") ?? "",
  );
  return match?.[1] &&
    !/^0+$/.test(match[1]) &&
    match[2] &&
    !/^0+$/.test(match[2])
    ? match[1]
    : null;
}
export function deviceSummary(request: Request): string {
  const ua = request.headers.get("User-Agent") ?? "";
  const browser = ua.includes("Edg/")
    ? "Edge"
    : ua.includes("Firefox/")
      ? "Firefox"
      : /Chrome\/|CriOS\//.test(ua)
        ? "Chrome"
        : ua.includes("Safari/")
          ? "Safari"
          : "Unknown browser";
  const platform = /iPhone|iPad/.test(ua)
    ? "iOS"
    : ua.includes("Android")
      ? "Android"
      : ua.includes("Windows")
        ? "Windows"
        : ua.includes("Macintosh")
          ? "macOS"
          : ua.includes("Linux")
            ? "Linux"
            : "Unknown platform";
  return `${browser} / ${platform}`;
}
