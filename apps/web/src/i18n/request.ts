// Load generated root parameter types before the fallback module declaration.
import type {} from "../../next-env";
import { locale } from "next/root-params";
import { notFound } from "next/navigation";
import { getRequestConfig } from "next-intl/server";
import { resolveRequestLocale } from "./resolve-request";
/** Supplies the root parameter's validated locale and catalogue to the framework. */
export default getRequestConfig(async () => {
  const config = resolveRequestLocale(await locale());
  if (!config) notFound();
  return config;
});
