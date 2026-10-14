import assert from "node:assert/strict";
import test from "node:test";
import { projectWorkhubTravelReportStatus } from "../src/reference/workhub/report-status";

test("#350 report read projection separates missing / running / failed / expired without exposing diagnostics", () => {
  const now = new Date("2026-10-14T00:00:00.000Z");
  assert.deepEqual(projectWorkhubTravelReportStatus(null, now), { state: "not_generated" });
  for (const state of ["pending", "generating", "failed", "ready"] as const) {
    assert.deepEqual(projectWorkhubTravelReportStatus({ status: state }, now), { state });
  }
  assert.deepEqual(projectWorkhubTravelReportStatus({ status: "ready", expiresAt: "2026-10-13T00:00:00.000Z" }, now), { state: "expired" });
  assert.deepEqual(projectWorkhubTravelReportStatus({ status: "ready", expiresAt: "2026-10-15T00:00:00.000Z" }, now), { state: "ready" });
  assert.deepEqual(projectWorkhubTravelReportStatus({ status: "failed", expiresAt: "2026-10-13T00:00:00.000Z" }, now), { state: "failed" });
  const raw = { status: "failed" as const, failureCode: "SELECT * FROM SECRET", objectIdentifier: "private/path" };
  assert.deepEqual(projectWorkhubTravelReportStatus(raw, now), { state: "failed" });
  assert.ok(!JSON.stringify(projectWorkhubTravelReportStatus(raw, now)).includes("SECRET"));
});
