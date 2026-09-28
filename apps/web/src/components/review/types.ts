export type FieldClass =
  | "person_name"
  | "identity_number"
  | "date"
  | "money"
  | "unit_code"
  | "plot_code"
  | "nationality"
  | "text";
export type ConfidenceCategory = "confirm" | "check" | "suggested";
export type FieldProvenance =
  "ai_confirmed" | "ai_edited" | "human_entered" | "not_on_document";
export interface SourceRegion {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface SuggestedFieldInput {
  id: string;
  label: string;
  fieldClass: FieldClass;
  value: string | null;
  modelCategory: ConfidenceCategory;
  region: SourceRegion | null;
  requiresSourceCheck: boolean;
  flagReason?: string;
}
export interface FieldDecision {
  status: "undecided" | "accepted" | "edited" | "not_on_document";
  value: string | null;
  sourceViewed: boolean;
}
export interface ReviewDocument {
  title: string;
  pages: { number: number; imageSrc: string; alt: string }[];
  synthetic: boolean;
}
export interface ExtractionProvenance {
  registryEntry: string;
  version: string;
  ranAt: string;
}
export type CommittedDecisions = Record<
  string,
  FieldDecision & { provenance: FieldProvenance }
>;
