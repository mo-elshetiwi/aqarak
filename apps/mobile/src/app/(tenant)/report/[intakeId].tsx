import type { ReactNode } from "react";
import { useLocalSearchParams } from "expo-router";
import { ReviewScreen } from "@/features/report/review-screen";
/** I isolate review visit state by the route's intake identifier. */
export default function IntakeRoute(): ReactNode {
  const { intakeId } = useLocalSearchParams<{ intakeId: string }>();
  return <ReviewScreen key={intakeId} intakeId={intakeId} />;
}
