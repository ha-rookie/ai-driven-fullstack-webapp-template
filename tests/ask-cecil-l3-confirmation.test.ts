import assert from "node:assert/strict";
import test from "node:test";
import {
  matchesCecilTravelReview, type CecilTravelDraft,
} from "../src/reference/workhub/travel-draft";

const reviewed: CecilTravelDraft = {
  destinationOfficeItemId: "office-tokyo",
  startDate: "2026-10-20",
  endDate: "2026-10-21",
  purpose: "顧客打ち合わせ",
};
test("L3 confirmation only matches the exact user-reviewed travel values", () => {
  assert.equal(matchesCecilTravelReview(reviewed, { ...reviewed }), true);
  for (const changed of [
    { destinationOfficeItemId: "office-osaka" },
    { startDate: "2026-10-19" },
    { endDate: "2026-10-22" },
    { purpose: "別の目的" },
  ]) {
    assert.equal(matchesCecilTravelReview(reviewed, { ...reviewed, ...changed }), false);
  }
});
