import { expect, it } from "vitest";
import config from "../../next.config";
import { securityHeaders } from "./security-headers";

it("applies the exact security policy to every route through Next headers", async () => {
  const expected = [
    {
      source: "/:path*",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "X-Frame-Options", value: "DENY" },
        {
          key: "Content-Security-Policy",
          value:
            "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
        },
        {
          key: "Permissions-Policy",
          value: "camera=(self), microphone=(self), geolocation=(), payment=()",
        },
        {
          key: "Strict-Transport-Security",
          value: "max-age=31536000; includeSubDomains",
        },
      ],
    },
  ];
  expect(securityHeaders()).toEqual(expected);
  expect(await config.headers?.()).toEqual(expected);
});
