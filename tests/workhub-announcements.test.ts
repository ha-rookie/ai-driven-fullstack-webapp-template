import assert from "node:assert/strict";
import test from "node:test";
import { validateAnnouncement, WorkhubAnnouncementError, canPublishWorkhubReferenceAnnouncement } from "../src/reference/workhub/announcements";

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
