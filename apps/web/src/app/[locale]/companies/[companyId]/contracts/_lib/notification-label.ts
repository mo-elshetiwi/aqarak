export function notificationLabel(template: string): string {
  const labels: Record<string, string> = {
    contract_approval_requested: "noticeApproval",
    contract_cancelled: "noticeCancelled",
    contract_concluded: "noticeConcluded",
    retroactive_contract_recorded: "noticeRecorded",
  };
  return labels[template] ?? "noticeUpdated";
}
