import enOwners from "../messages/en/Owners.json";
import arOwners from "../messages/ar/Owners.json";
import enProperties from "../messages/en/Properties.json";
import arProperties from "../messages/ar/Properties.json";
import enUnits from "../messages/en/Units.json";
import arUnits from "../messages/ar/Units.json";
import enTenants from "../messages/en/Tenants.json";
import arTenants from "../messages/ar/Tenants.json";
import enDocuments from "../messages/en/Documents.json";
import arDocuments from "../messages/ar/Documents.json";
import enContracts from "../messages/en/Contracts.json";
import arContracts from "../messages/ar/Contracts.json";
import enApprovals from "../messages/en/Approvals.json";
import arApprovals from "../messages/ar/Approvals.json";
import enNotifications from "../messages/en/Notifications.json";
import arNotifications from "../messages/ar/Notifications.json";
import enReport from "../messages/en/Report.json";
import arReport from "../messages/ar/Report.json";
import enMaintenance from "../messages/en/Maintenance.json";
import arMaintenance from "../messages/ar/Maintenance.json";
import enCompany from "../messages/en/Company.json";
import arCompany from "../messages/ar/Company.json";
import enMembers from "../messages/en/Members.json";
import arMembers from "../messages/ar/Members.json";
import enAudit from "../messages/en/Audit.json";
import arAudit from "../messages/ar/Audit.json";
import enTawtheeq from "../messages/en/Tawtheeq.json";
import arTawtheeq from "../messages/ar/Tawtheeq.json";
import enNavigation from "../messages/en/Navigation.json";
import arNavigation from "../messages/ar/Navigation.json";
import enShell from "../messages/en/Shell.json";
import arShell from "../messages/ar/Shell.json";
import enAuth from "../messages/en/Auth.json";
import arAuth from "../messages/ar/Auth.json";
import enReview from "../messages/en/Review.json";
import arReview from "../messages/ar/Review.json";
import enApproval from "../messages/en/Approval.json";
import arApproval from "../messages/ar/Approval.json";
import enCommon from "../messages/en/Common.json";
import arCommon from "../messages/ar/Common.json";
import enTheme from "../messages/en/Theme.json";
import arTheme from "../messages/ar/Theme.json";
import enStatus from "../messages/en/Status.json";
import arStatus from "../messages/ar/Status.json";
import enStates from "../messages/en/States.json";
import arStates from "../messages/ar/States.json";
import enFormat from "../messages/en/Format.json";
import arFormat from "../messages/ar/Format.json";
import enShowcase from "../messages/en/Showcase.json";
import arShowcase from "../messages/ar/Showcase.json";
import en from "../messages/en.json";
import ar from "../messages/ar.json";
/** Locales available to both application renderers. */
export const locales = ["en", "ar"] as const;
/** Supported language identifier. */
export type Locale = (typeof locales)[number];
/** Language used when no supported preference is available. */
export const defaultLocale: Locale = "en";
/** Message structure shared by all catalogues. */
const english = {
  Owners: enOwners,
  Properties: enProperties,
  Units: enUnits,

  ...en,
  Tenants: enTenants,
  Documents: enDocuments,
  Report: enReport,
  Maintenance: enMaintenance,
  Audit: enAudit,
  Tawtheeq: enTawtheeq,
  Navigation: enNavigation,
  Shell: enShell,
  Auth: enAuth,
  Members: enMembers,
  Company: enCompany,
  Common: enCommon,
  Theme: enTheme,
  Status: enStatus,
  States: enStates,
  Format: enFormat,
  Showcase: enShowcase,
  Review: enReview,
  Approval: enApproval,
  Contracts: enContracts,
  Approvals: enApprovals,
  Notifications: enNotifications,
};
const arabic = {
  Owners: arOwners,
  Properties: arProperties,
  Units: arUnits,

  ...ar,
  Tenants: arTenants,
  Documents: arDocuments,
  Report: arReport,
  Maintenance: arMaintenance,
  Audit: arAudit,
  Tawtheeq: arTawtheeq,
  Navigation: arNavigation,
  Shell: arShell,
  Auth: arAuth,
  Members: arMembers,
  Company: arCompany,
  Common: arCommon,
  Theme: arTheme,
  Status: arStatus,
  States: arStates,
  Format: arFormat,
  Showcase: arShowcase,
  Review: arReview,
  Approval: arApproval,
  Contracts: arContracts,
  Approvals: arApprovals,
  Notifications: arNotifications,
};
export type Messages = typeof english;
/** Checks an external value before using it as a locale. */
export function isLocale(value: unknown): value is Locale {
  return locales.some((locale) => locale === value);
}
/** Returns the reading direction for a supported locale. */
export function getDirection(locale: Locale): "ltr" | "rtl" {
  return locale === "ar" ? "rtl" : "ltr";
}
/** Returns the other supported language for the language switcher. */
export function getAlternateLocale(locale: Locale): Locale {
  return locale === "en" ? "ar" : "en";
}
/** Loads the message catalogue for a supported locale. */
export function getMessages(locale: Locale): Messages {
  return locale === "ar" ? arabic : english;
}
/** Exposes complete bilingual labels for the public domain model. */
export { getDomainLabels, domainLabel } from "./domain-labels";
export type {
  DomainLabels,
  DomainVocabularyName,
  DomainVocabularyValue,
} from "./domain-labels";
