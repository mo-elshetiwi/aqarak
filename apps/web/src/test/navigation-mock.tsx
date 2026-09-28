import type { ComponentProps, ReactElement } from "react";
import { vi } from "vitest";
vi.mock("@/i18n/navigation", () => ({
  Link: function TestLink({
    href,
    children,
    ...props
  }: ComponentProps<"a">): ReactElement {
    return (
      <a href={href} {...props}>
        {children}
      </a>
    );
  },
}));
