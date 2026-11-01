import { createLocalization, type Localization, type LocalizationPreferences, type MessageCatalogs } from "./localization";
import type { ReportViewModel } from "./report/report";

/** #289: Consumers select their own audience; #288 alone owns user preference resolution. */
export interface LocalizationCatalogSource {
  readonly catalogs: MessageCatalogs;
  readonly fallbackLocale: string;
}

const localize = (preferences: LocalizationPreferences, source: LocalizationCatalogSource): Localization =>
  createLocalization({ preferences, catalogs: source.catalogs, fallbackLocale: source.fallbackLocale });

/** Resolve the recipient at send time, not the sender or provider account. No email delivery occurs here. */
export const createEmailTemplateLocalization = (
  recipient: LocalizationPreferences,
  source: LocalizationCatalogSource,
): Localization => localize(recipient, source);

/** Only notification chrome, dates and titles selected by the application are translated.
 * Announcement business title/body remain original authored content. */
export const createAnnouncementChromeLocalization = (
  viewer: LocalizationPreferences,
  source: LocalizationCatalogSource,
): Localization => localize(viewer, source);

/** Existing #286 ReportViewModel already records locale and timezone; no alternative storage. */
export const createReportRendererLocalization = (
  report: Pick<ReportViewModel<unknown>, "locale" | "timezone">,
  source: LocalizationCatalogSource,
): Localization => localize(report, source);
