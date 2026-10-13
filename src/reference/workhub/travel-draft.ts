/** In-memory L2 reference proposal. Never persisted or submitted by Ask CECIL. */
export interface CecilTravelDraft {
  readonly destinationOfficeItemId: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly purpose: string;
}
export interface CecilTravelOffice {
  readonly itemId: string;
  readonly label: string;
  readonly code: string;
}
const isDate = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
};
/** Mirrors the baseline TravelRequestService constraints for user input only.
 * BusinessService remains authoritative upon actual command execution. */
export const validateCecilTravelDraft = (
  draft: CecilTravelDraft,
  offices: readonly CecilTravelOffice[],
): string | null => {
  if (!draft.destinationOfficeItemId || !offices.some(o => o.itemId === draft.destinationOfficeItemId)) {
    return "現在選択可能な出張先を指定してください。";
  }
  if (!isDate(draft.startDate) || !isDate(draft.endDate)) {
    return "開始日と終了日を正しい日付で入力してください。";
  }
  if (draft.startDate > draft.endDate) return "終了日は開始日以降にしてください。";
  if (!draft.purpose.trim() || draft.purpose.trim().length > 2_000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(draft.purpose)) {
    return "目的は1〜2000文字で入力してください。";
  }
  return null;
};
export const isAuthorizedCecilTravelApp = (apps: unknown): boolean =>
  Array.isArray(apps) && apps.some(item =>
    item && typeof item === "object" && item.key === "travel-request"
    && item.availability === "available" && item.launchTarget === "/#workhub-requests");
