/** Applies the baseline browser security policy to every route. */
export function securityHeaders(): {
  source: string;
  headers: { key: string; value: string }[];
}[] {
  // The inline theme script requires a separate nonce-based policy before adding script-src.
  return [
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
}
