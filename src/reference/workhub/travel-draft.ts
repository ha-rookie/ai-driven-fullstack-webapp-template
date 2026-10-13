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
  const hasInvalidControls = [...draft.purpose].some(character => {
    const code = character.charCodeAt(0);
    return ((code >= 0 && code <= 31) || code === 127) && ![9, 10, 13].includes(code);
  });
  if (!draft.purpose.trim() || draft.purpose.trim().length > 2_000 || hasInvalidControls) {
    return "目的は1〜2000文字で入力してください。";
  }
  return null;
};
export const isAuthorizedCecilTravelApp = (apps: unknown): boolean =>
  Array.isArray(apps) && apps.some(item =>
    item && typeof item === "object" && item.key === "travel-request"
    && item.availability === "available" && item.launchTarget === "/#workhub-requests");

/** Comparison against the currently displayed user-editable fields.
 * Any change invalidates a previously requested L3 human confirmation. */
export const matchesCecilTravelReview = (review: CecilTravelDraft, current: CecilTravelDraft): boolean =>
  review.destinationOfficeItemId === current.destinationOfficeItemId
  && review.startDate === current.startDate
  && review.endDate === current.endDate
  && review.purpose === current.purpose;
