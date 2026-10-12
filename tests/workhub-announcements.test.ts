import assert from "node:assert/strict";
import test from "node:test";
import { validateAnnouncement, validateAnnouncementDelivery, WorkhubAnnouncementError, canPublishWorkhubReferenceAnnouncement } from "../src/reference/workhub/announcements";

test("official announcements have bounded, non-empty title and body", () => {
  assert.deepEqual(validateAnnouncement("  部署からのお知らせ ", " 一行目\n二行目 "), {
    title: "部署からのお知らせ", body: "一行目\n二行目",
  });
  for (const [title, body] of [
    ["", "本文"], ["件名", ""], ["a".repeat(121), "本文"],
    ["件名", "a".repeat(2001)], ["件名\n悪意のある改行", "本文"],
    ["件名", "本文\u0000制御コード"],
  ] as const) {
    assert.throws(
      () => validateAnnouncement(title, body),
      (error: unknown) => error instanceof WorkhubAnnouncementError && error.code === "invalid_input",
    );
  }
});

test("reference publication requires the actual General Affairs principal and current corporate role", () => {
  assert.equal(canPublishWorkhubReferenceAnnouncement("workhub-demo-sora", "corporate"), true);
  for (const [principal, role] of [
    ["workhub-demo-sora", "employee"],
    ["workhub-demo-sora", "system_admin"],
    ["workhub-demo-sora", "unknown"],
    ["workhub-demo-aoi", "corporate"],
    ["workhub-demo-ren", "manager"],
    ["", "corporate"],
  ]) {
    assert.equal(canPublishWorkhubReferenceAnnouncement(principal, role), false, `${principal} / ${role}`);
  }
});

test("announcement delivery defaults preserve existing company-wide normal posts", () => {
  const now = new Date("2026-10-12T14:00:00.000Z");
  assert.deepEqual(validateAnnouncementDelivery({}, now), {
    importance: "normal", audienceRole: null, audienceDepartment: null,
    visibleFrom: "2026-10-12T14:00:00.000Z", visibleUntil: null,
  });
  assert.deepEqual(validateAnnouncementDelivery({ importance: "critical", audienceRole: "manager", audienceDepartment: null,
    visibleFrom: "2026-10-12T15:00:00.000Z", visibleUntil: "2026-10-12T16:00:00.000Z" }, now), {
    importance: "critical", audienceRole: "manager", audienceDepartment: null,
    visibleFrom: "2026-10-12T15:00:00.000Z", visibleUntil: "2026-10-12T16:00:00.000Z",
  });
  assert.equal(validateAnnouncementDelivery({ importance: "important", audienceRole: "" }).audienceRole, null);
});

test("announcement delivery validation fails closed on unsafe roles, severity or scheduling", () => {
  const invalid = [
    { importance: "emergency" }, { importance: 2 }, { audienceRole: "other-company" },
    { audienceRole: ["manager"] }, { audienceRole: "root" },
    { audienceDepartment: "engineering!" }, { audienceDepartment: ["finance"] },
    { audienceDepartment: "unknown" }, { audienceDepartment: 5 },
    { visibleFrom: "not-a-date" }, { visibleFrom: "2026-13-01T00:00:00.000Z" },
    { visibleFrom: "2026-10-12" }, { visibleFrom: "2026-10-12T00:00:00Z" },
    { visibleUntil: "tomorrow" },
    { visibleFrom: "2026-10-12T12:00:00.000Z", visibleUntil: "2026-10-12T12:00:00.000Z" },
    { visibleFrom: "2026-10-12T13:00:00.000Z", visibleUntil: "2026-10-12T12:00:00.000Z" },
  ] as const;
  for (const delivery of invalid) {
    assert.throws(
      () => validateAnnouncementDelivery(delivery),
      (error: unknown) => error instanceof WorkhubAnnouncementError && error.code === "invalid_input",
      JSON.stringify(delivery),
    );
  }
});

test("department audience is independent of a member's business role", () => {
  const when = new Date("2026-10-12T14:00:00.000Z");
  const audience = validateAnnouncementDelivery({
    audienceDepartment: "engineering",
  }, when);
  assert.equal(audience.audienceRole, null);
  assert.equal(audience.audienceDepartment, "engineering");
  const both = validateAnnouncementDelivery({
    audienceRole: "manager", audienceDepartment: "engineering",
  }, when);
  assert.equal(both.audienceRole, "manager");
  assert.equal(both.audienceDepartment, "engineering");
  assert.equal(validateAnnouncementDelivery({ audienceDepartment: "" }, when).audienceDepartment, null);
});
