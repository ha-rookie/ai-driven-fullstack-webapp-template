import type {
  InboundWebhookBusinessHandler,
  InboundWebhookBusinessMapper,
  VerifiedInboundWebhookEvent,
} from "../../../worker/inbound-webhook";

export const WORKHUB_TRAVEL_BOOKING_CONFIRMED_EVENT_TYPE = "travel.booking_confirmed";

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/;
const BOOKING_REFERENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/;

export interface WorkhubTravelBookingConfirmationCommand {
  readonly travelRequestId: string;
  readonly bookingReference: string;
}

export interface WorkhubTravelBookingConfirmationService {
  confirmBooking(
    command: WorkhubTravelBookingConfirmationCommand,
    context: { readonly receiptId: string; readonly environment: string },
  ): Promise<void>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export class WorkhubTravelBookingConfirmationMapper
implements InboundWebhookBusinessMapper<WorkhubTravelBookingConfirmationCommand> {
  map(event: VerifiedInboundWebhookEvent): WorkhubTravelBookingConfirmationCommand | null {
    if (event.eventType !== WORKHUB_TRAVEL_BOOKING_CONFIRMED_EVENT_TYPE) return null;
    if (!isRecord(event.payload)) throw new TypeError("travel booking confirmation payload must be an object");

    const travelRequestId = event.payload.travelRequestId;
    const bookingReference = event.payload.bookingReference;
    if (typeof travelRequestId !== "string" || !IDENTIFIER_PATTERN.test(travelRequestId)) {
      throw new TypeError("travelRequestId must be a bounded opaque identifier");
    }
    if (typeof bookingReference !== "string" || !BOOKING_REFERENCE_PATTERN.test(bookingReference)) {
      throw new TypeError("bookingReference must be a bounded reference");
    }

    return Object.freeze({ travelRequestId, bookingReference });
  }
}

export class WorkhubTravelBookingConfirmationHandler
implements InboundWebhookBusinessHandler<WorkhubTravelBookingConfirmationCommand> {
  constructor(private readonly service: WorkhubTravelBookingConfirmationService) {}

  handle(
    command: WorkhubTravelBookingConfirmationCommand,
    context: { readonly receiptId: string; readonly environment: string },
  ): Promise<void> {
    return this.service.confirmBooking(command, context);
  }
}
