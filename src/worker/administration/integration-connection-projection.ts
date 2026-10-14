/**
 * #419 Stage7: provider-neutral connection monitoring boundary.
 *
 * WORKHUB currently has a local Outbox, but no provider-specific probe
 * registry wired into the administration API. These records describe which
 * integration categories lack monitoring. They are NOT provider probes,
 * connected accounts, supported production capabilities, or health checks.
 *
 * A future provider adapter must add an independently authorized, bounded
 * observation source before it can report ready/degraded/unavailable.
 */
export type IntegrationCapability =
  | "outbound_delivery"
  | "inbound_webhook"
  | "external_document_storage";

export interface ConnectionObservation {
  readonly capability: IntegrationCapability;
  readonly connectionState: "unknown";
  readonly monitoringState: "not_monitored";
  readonly providerCheckAt: null;
  readonly safeFailureCode: null;
}

export interface ConnectionStatusProjection {
  readonly schemaVersion: 1;
  readonly coverage: "capability_categories";
  readonly source: "no_provider_monitor_registered";
  readonly connections: readonly ConnectionObservation[];
}

/** Never synthesize a healthy provider from local Outbox success or zero failures. */
export const unmonitoredConnectionProjection = (): ConnectionStatusProjection => ({
  schemaVersion: 1,
  coverage: "capability_categories",
  source: "no_provider_monitor_registered",
  connections: [
    { capability: "outbound_delivery", connectionState: "unknown",
      monitoringState: "not_monitored", providerCheckAt: null, safeFailureCode: null },
    { capability: "inbound_webhook", connectionState: "unknown",
      monitoringState: "not_monitored", providerCheckAt: null, safeFailureCode: null },
    { capability: "external_document_storage", connectionState: "unknown",
      monitoringState: "not_monitored", providerCheckAt: null, safeFailureCode: null },
  ],
});
