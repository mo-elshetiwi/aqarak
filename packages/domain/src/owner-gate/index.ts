import type { PropertyId } from "../ids";
import type { LocalDate } from "../time";
import type { CompanyKind, OwnerMandateStatus } from "../vocabulary";

/** Supplies company policy when computing the owner gate at submission. */
export interface OwnerGateCompany {
  readonly kind: CompanyKind;
  readonly defaultOwnerGate: boolean;
}

/** Supplies the property override when computing the owner gate. */
export interface OwnerGateProperty {
  readonly id: PropertyId;
  readonly ownerGateOverride: boolean | null;
}

/** Supplies the recorded mandate and its inclusive period of authority. */
export interface OwnerGateMandate {
  readonly status: OwnerMandateStatus;
  readonly propertyIds: readonly PropertyId[];
  readonly startsOn: LocalDate;
  readonly endsOn: LocalDate | null;
  readonly ownerGate: boolean | null;
}

/** Computes R9 precedence once, for freezing on the submitted contract version. */
export function ownerGate(
  company: OwnerGateCompany,
  property: OwnerGateProperty,
  mandate: OwnerGateMandate | null,
  on: LocalDate,
): boolean {
  if (company.kind === "self_managed_owner") return false;
  if (property.ownerGateOverride !== null) return property.ownerGateOverride;
  if (
    mandate !== null &&
    mandate.status === "active" &&
    mandate.startsOn <= on &&
    (mandate.endsOn === null || on <= mandate.endsOn) &&
    mandate.propertyIds.includes(property.id) &&
    mandate.ownerGate !== null
  ) {
    return mandate.ownerGate;
  }
  return company.defaultOwnerGate;
}
