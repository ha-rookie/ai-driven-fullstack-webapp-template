import assert from "node:assert/strict";
import test from "node:test";
import { buildMasterOperationLinks, type MasterProjectOperationConfig } from "../src/reference/admin/master-admin-operation-config";

const scopeId = "demo-scope";
const masterKey = "demo.department";
const target = (itemId: string, override: Partial<{ scopeId: string; masterKey: string }> = {}) => ({
  scopeId, masterKey, itemId, ...override,
});
const config = (overrides: Partial<MasterProjectOperationConfig> = {}): MasterProjectOperationConfig => ({
  scopeId, masterKey,
  retireTarget: target("retire"),
  scheduleTargets: [
    { ...target("schedule"), variant: "revision", effectiveFrom: "2027-04-01T00:00:00.000Z", label: "Future" },
    { ...target("order"), variant: "order", effectiveFrom: "2027-04-01T00:00:00.000Z", label: "Same", displayOrder: 3 },
  ],
  availabilityTargets: [{ ...target("availability"), enabled: false, label: "Disable" }],
  ...overrides,
});

test("Project's eligible capabilities map to fixed operation panel anchors only", () => {
  const result = buildMasterOperationLinks(config());
  assert.deepEqual(Object.keys(result).sort(), ["retire", "schedule", "order", "availability"].sort());
  assert.equal(result.retire.href, "#admin-master-retire-demo");
  assert.equal(result.schedule.href, "#admin-master-schedule-demo");
  assert.equal(result.order.href, "#admin-master-order-demo");
  assert.equal(result.availability.href, "#admin-master-availability");
});

test("cross-scope and cross-definition capability declarations are never linked", () => {
  const result = buildMasterOperationLinks(config({
    retireTarget: target("other-scope", { scopeId: "outsider" }),
    scheduleTargets: [{ ...target("other-master", { masterKey: "outside.key" }),
      variant: "revision", effectiveFrom: "2027-04-01T00:00:00.000Z", label: "Other" }],
    availabilityTargets: [{ ...target("allowed"), enabled: true, label: "Enable" }],
  }));
  assert.deepEqual(Object.keys(result), ["allowed"]);
  assert.equal(result["other-scope"], undefined);
  assert.equal(result["other-master"], undefined);
});

test("duplicate contradictory target declarations fail closed instead of picking one action", () => {
  const result = buildMasterOperationLinks(config({
    scheduleTargets: [
      { ...target("retire"), variant: "order", effectiveFrom: "2027-04-01T00:00:00.000Z", label: "Wrong" },
    ],
    availabilityTargets: [{ ...target("retire"), enabled: true, label: "Wrong again" }],
  }));
  assert.equal(result.retire, undefined);
  assert.deepEqual(Object.keys(result), []);
});

test("special object keys cannot inherit capabilities from Object.prototype", () => {
  const result = buildMasterOperationLinks(config({
    retireTarget: target("__proto__"),
    scheduleTargets: [],
    availabilityTargets: [{ ...target("constructor"), enabled: false, label: "Disable" }],
  }));
  assert.equal(Object.getPrototypeOf(result), null);
  assert.equal(result["__proto__"]?.href, "#admin-master-retire-demo");
  assert.equal(result["constructor"]?.href, "#admin-master-availability");
});
