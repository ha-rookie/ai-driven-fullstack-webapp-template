import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { D1UserPreferencesStore } from "../src/worker/d1-user-preferences-store";
import { UserPreferenceConflictError } from "../src/shared/in-memory-user-preferences-store";
import type { UserPreferencePolicy } from "../src/shared/user-preferences";

const policy: UserPreferencePolicy = {
  locale: { allowed: ["ja-JP", "en-US"], systemDefault: "ja-JP" },
  timezone: { allowed: ["Asia/Tokyo", "UTC"], systemDefault: "UTC" },
  theme: { allowed: ["light", "dark", "system"], systemDefault: "system" },
};

const fixture = () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON; CREATE TABLE users (id TEXT PRIMARY KEY);");
  sqlite.exec(readFileSync("migrations/0038_user_preferences.sql", "utf8"));
  sqlite.prepare("INSERT INTO users (id) VALUES (?), (?)").run("aoi", "ren");
  const db = {
    prepare(query: string) {
      const statement = sqlite.prepare(query);
      return { bind(...args: (string | number | null)[]) {
        return {
          first: async () => (statement.get(...args) ?? null),
          run: async () => ({ meta: { changes: statement.run(...args).changes } }),
        };
      } };
    },
  } as unknown as D1Database;
  return { sqlite, store: new D1UserPreferencesStore(db) };
};

test("D1 migration/store persists preferences across new store instances, isolates user/environment", async () => {
  const { sqlite, store } = fixture();
  try {
    const saved = await store.update({
      userId: "aoi", environment: "preview", expectedVersion: 0,
      patch: { locale: "en-US", timezone: "Asia/Tokyo", theme: "system" },
    }, policy);
    assert.equal(saved.version, 1);
    assert.equal(saved.theme, "system");
    assert.equal((await store.get("aoi", "preview"))?.locale, "en-US");
    assert.equal(await store.get("ren", "preview"), null);
    assert.equal(await store.get("aoi", "production"), null);
    assert.equal(sqlite.prepare("SELECT count(*) AS n FROM user_preferences").get()?.n, 1);
    const updated = await store.update({
      userId: "aoi", environment: "preview", expectedVersion: 1, patch: { theme: null },
    }, policy);
    assert.equal(updated.version, 2);
    assert.equal(updated.locale, "en-US");
    assert.equal(updated.theme, null);
    await assert.rejects(store.update({
      userId: "aoi", environment: "preview", expectedVersion: 1, patch: { theme: "dark" },
    }, policy), (error: unknown) => error instanceof UserPreferenceConflictError);
    assert.equal((await store.get("aoi", "preview"))?.version, 2);
    await assert.rejects(store.update({
      userId: "aoi", environment: "preview", expectedVersion: 0, patch: { theme: "dark" },
    }, policy), (error: unknown) => error instanceof UserPreferenceConflictError);
    assert.equal((await store.get("aoi", "preview"))?.theme, null);
  } finally {
    sqlite.close();
  }
});

test("D1 store rejects arbitrary fields and FK-invalid users without writing, cascades deletion", async () => {
  const { sqlite, store } = fixture();
  try {
    await assert.rejects(store.update({
      userId: "aoi", environment: "test", expectedVersion: 0,
      patch: { theme: "dark", token: "no" } as never,
    }, policy), /Invalid preference/);
    await assert.rejects(store.update({
      userId: "missing", environment: "test", expectedVersion: 0, patch: { locale: "ja-JP" },
    }, policy));
    assert.equal(await store.get("aoi", "test"), null);
    await store.update({ userId: "ren", environment: "local", expectedVersion: 0, patch: { theme: "dark" } }, policy);
    sqlite.prepare("DELETE FROM users WHERE id = ?").run("ren");
    assert.equal(await store.get("ren", "local"), null);
  } finally {
    sqlite.close();
  }
});
