/** Safe, read-only report status for an already-authorized travel request.
 * The workflow decision is authoritative; report generation is a projection.
 * Never expose failureCode, storage identifiers, or any retry command.
 */
export type WorkhubTravelReportState =
  | "not_generated" | "pending" | "generating" | "ready" | "failed" | "expired" | "unavailable";

export interface WorkhubTravelReportStatus {
  readonly state: WorkhubTravelReportState;
}

export const projectWorkhubTravelReportStatus = (
  artifact: { readonly status: "pending" | "generating" | "ready" | "failed"; readonly expiresAt?: string } | null,
  now: Date = new Date(),
): WorkhubTravelReportStatus => {
  if (!artifact) return { state: "not_generated" };
  if (artifact.status === "ready" && artifact.expiresAt !== undefined) {
    const expiry = Date.parse(artifact.expiresAt);
    // Corrupted expiry cannot be advertised as a safely downloadable report.
    if (!Number.isFinite(expiry) || new Date(expiry).toISOString() !== artifact.expiresAt) {
      return { state: "unavailable" };
    }
    if (expiry <= now.getTime()) return { state: "expired" };
  }
  return { state: artifact.status };
};
