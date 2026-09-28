import { z } from "zod";
import { fieldClass } from "../extraction/fields";

const requiredVariables = [
  "OPENAI_API_KEY",
  "PIPELINE_SECRET_ARN",
  "AWS_REGION",
  "DATABASE_CLUSTER_ARN",
  "APP_SECRET_ARN",
  "DOCUMENTS_BUCKET_NAME",
  "DOCUMENT_KEY_PREFIX",
] as const;

export function smokeEnabled(environment: NodeJS.ProcessEnv): boolean {
  return (
    environment.J3_SMOKE === "1" &&
    environment.LIVE_MODELS === "1" &&
    environment.J3_DEV_DATABASE === "1" &&
    environment.DATABASE_NAME === "aqarak_tenants" &&
    environment.DOCUMENT_KEY_PREFIX?.startsWith("test/tenants/") === true &&
    requiredVariables.every((name) => Boolean(environment[name]?.trim()))
  );
}

export function goldDecision(
  name: string,
  suggestion: string | null,
  gold: string | null | undefined,
): {
  readonly decision: "accepted" | "edited" | "not_on_document";
  readonly value?: string;
  readonly sourceViewed: true;
  readonly expectedVersion: null;
} {
  const common = { sourceViewed: true, expectedVersion: null } as const;
  if (gold == null) return { ...common, decision: "not_on_document" };
  const value =
    fieldClass(name) === "date" ? z.iso.date().parse(gold.trim()) : gold.trim();
  return suggestion !== null && suggestion.trim() === value
    ? { ...common, decision: "accepted" }
    : { ...common, decision: "edited", value };
}
