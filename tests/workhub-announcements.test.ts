import assert from "node:assert/strict";
import test from "node:test";
import { validateAnnouncement, WorkhubAnnouncementError } from "../src/reference/workhub/announcements";

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
