"use client";
import type { ReactElement } from "react";
import { useTranslations } from "next-intl";
export function SkipLink(): ReactElement {
  const translate = useTranslations("Auth");
  return (
    <a
      href="#main"
      className="sr-only focus:not-sr-only focus:fixed focus:start-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-background focus:p-4 focus:text-foreground"
      onClick={(event) => {
        const main =
          document.getElementById("main") ?? document.querySelector("main");
        if (!main) return;
        event.preventDefault();
        main.tabIndex = -1;
        main.focus();
      }}
    >
      {translate("skip")}
    </a>
  );
}
