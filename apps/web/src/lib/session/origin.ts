import { getAppOrigin } from "./config";
/** Requires browser origin and fetch metadata to agree with the public origin. */
export function checkRequestOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  const site = request.headers.get("sec-fetch-site");
  if (!origin || (site !== null && site !== "same-origin")) return false;
  const configured = getAppOrigin();
  if (configured) return origin === configured;
  const url = new URL(request.url);
  const protocol =
    request.headers.get("x-forwarded-proto") ?? url.protocol.slice(0, -1);
  const host =
    request.headers.get("x-forwarded-host") ??
    request.headers.get("host") ??
    url.host;
  if (!["http", "https"].includes(protocol) || /[\s,/@\\]/.test(host))
    return false;
  return origin === `${protocol}://${host}`;
}
