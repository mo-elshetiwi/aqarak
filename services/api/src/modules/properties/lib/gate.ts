import {
  ownerGate,
  type OwnerGateCompany,
  type OwnerGateProperty,
  type OwnerGateMandate,
  type LocalDate,
  localDateOf,
  utcInstant,
} from "./domain";
export type GateSource =
  "self_managed" | "property_override" | "mandate" | "company_default";
export function today(): LocalDate {
  return localDateOf(utcInstant.parse(new Date().toISOString()));
}
export function ownerGateSource(
  company: OwnerGateCompany,
  property: OwnerGateProperty,
  mandate: OwnerGateMandate | null,
  on: LocalDate,
): GateSource {
  if (company.kind === "self_managed_owner") return "self_managed";
  if (property.ownerGateOverride !== null) return "property_override";
  if (
    mandate?.status === "active" &&
    mandate.startsOn <= on &&
    (mandate.endsOn === null || mandate.endsOn >= on) &&
    mandate.propertyIds.includes(property.id) &&
    mandate.ownerGate !== null
  )
    return "mandate";
  return "company_default";
}
export function gate(
  company: OwnerGateCompany,
  property: OwnerGateProperty,
  mandate: OwnerGateMandate | null,
  on: LocalDate,
): { value: boolean; source: GateSource } {
  return {
    value: ownerGate(company, property, mandate, on),
    source: ownerGateSource(company, property, mandate, on),
  };
}
export function maskEid(value: string | null): string | null {
  return value ? value.slice(0, 3) + "•".repeat(10) + value.slice(-2) : null;
}
export function maskPassport(value: string | null): string | null {
  return value
    ? "•".repeat(Math.max(0, value.length - 3)) + value.slice(-3)
    : null;
}
