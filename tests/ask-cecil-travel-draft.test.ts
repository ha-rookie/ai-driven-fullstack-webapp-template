import assert from "node:assert/strict";
import test from "node:test";
import {
  isAuthorizedCecilTravelApp,
  validateCecilTravelDraft,
  type CecilTravelDraft,
  type CecilTravelOffice,
} from "../src/reference/workhub/travel-draft";

const offices: CecilTravelOffice[] = [
  { itemId: "office-tokyo", code: "TOKYO", label: "東京" },
  { itemId: "office-osaka", code: "OSAKA", label: "大阪" },
];
const good: CecilTravelDraft = {
  destinationOfficeItemId: "office-tokyo",
  startDate: "2026-10-19",
  endDate: "2026-10-20",
  purpose: "顧客との打ち合わせ",
};

test("L2 local proposal fields validate against current selectable offices", () => {
  assert.equal(validateCecilTravelDraft(good, offices), null);
  assert.match(validateCecilTravelDraft({ ...good, destinationOfficeItemId: "forged" }, offices)!, /出張先/u);
  assert.match(validateCecilTravelDraft({ ...good, destinationOfficeItemId: "" }, offices)!, /出張先/u);
  assert.match(validateCecilTravelDraft(good, [])!, /出張先/u);
});

test("L2 date and purpose are user-specified; missing or invalid data fails closed", () => {
  for (const changes of [
    { startDate: "" },
    { startDate: "2026-02-30" },
    { endDate: "2026-10-18" },
    { purpose: "" },
    { purpose: " ".repeat(4) },
    { purpose: "x".repeat(2001) },
    { purpose: "\u0000bad" },
  ]) {
    assert.notEqual(validateCecilTravelDraft({ ...good, ...changes }, offices), null);
  }
  assert.equal(validateCecilTravelDraft({ ...good, startDate: "2026-10-19", endDate: "2026-10-19" }, offices), null);
});

test("L2 eligibility needs current server-listed Travel Request app, not a client role", () => {
  assert.equal(isAuthorizedCecilTravelApp([
    { key: "travel-request", availability: "available", launchTarget: "/#workhub-requests" },
  ]), true);
  for (const apps of [
    [], null, {}, [{ key: "approval-tasks", availability: "available", launchTarget: "/#workhub-my-work" }],
    [{ key: "travel-request", availability: "unavailable", launchTarget: "/#workhub-requests" }],
    [{ key: "travel-request", availability: "available", launchTarget: "https://evil.example" }],
    [{ key: "travel-request", availability: "available", launchTarget: "/admin" }],
  ]) assert.equal(isAuthorizedCecilTravelApp(apps), false);
});
