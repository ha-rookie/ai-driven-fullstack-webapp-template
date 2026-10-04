import type {
  BusinessActivityFormatter,
  BusinessActivityFormatContext,
  BusinessActivityPresentation,
  BusinessActivityRecord,
} from "./types";

export type BusinessActivityMessageTemplate = (input: {
  readonly entry: BusinessActivityRecord;
  readonly actorDisplay: string | null;
}) => string;

export interface StaticBusinessActivityFormatterOptions {
  readonly messages: Readonly<Record<string, Readonly<Record<string, BusinessActivityMessageTemplate>>>>;
  readonly fallbackLocale?: string;
}

export class StaticBusinessActivityFormatter implements BusinessActivityFormatter {
  private readonly fallbackLocale: string;

  constructor(private readonly options: StaticBusinessActivityFormatterOptions) {
    this.fallbackLocale = options.fallbackLocale ?? "en-US";
  }

  format(
    entry: BusinessActivityRecord,
    context: BusinessActivityFormatContext,
  ): BusinessActivityPresentation {
    const localeMessages = this.options.messages[context.locale]
      ?? this.options.messages[this.fallbackLocale];
    const template = localeMessages?.[entry.activityType];
    if (!template) throw new Error(`timeline message is not configured: ${entry.activityType}`);
    const actorDisplay = context.actorDisplay ?? entry.actorDisplaySnapshot ?? entry.actorRef;
    return {
      messageKey: `timeline.${entry.activityType}`,
      message: template({ entry, actorDisplay }),
      occurredAt: entry.occurredAt,
    };
  }
}
