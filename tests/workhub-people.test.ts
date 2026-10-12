import assert from "node:assert/strict";
import test from "node:test";
import { listWorkhubReferencePeople } from "../src/reference/workhub/people";
import { WORKHUB_PERSONAS } from "../src/reference/workhub/personas";

test("people directory is a safe explicit projection of the six fictional reference personas", () => {
  const entries = listWorkhubReferencePeople();
  assert.equal(entries.length, WORKHUB_PERSONAS.length);
  assert.deepEqual(entries.map(person => person.displayName), WORKHUB_PERSONAS.map(person => person.displayName));
  for (const person of entries) {
    assert.deepEqual(Object.keys(person).sort(), ["displayName", "organizationLabel", "roleLabel"]);
    assert.ok(person.displayName && person.roleLabel);
    assert.match(person.organizationLabel, /デモ/u);
  }
  const serialized = JSON.stringify(entries);
  assert.doesNotMatch(serialized, /workhub-demo-|Workhub-Demo-2026!|internalUserId|userId|homeHint|password/iu);
});
