import assert from "node:assert/strict";
import test from "node:test";
import { listWorkhubApps } from "../src/reference/workhub/app-catalog";

const keys = (role: string) => listWorkhubApps(role).map(app => app.key);

test("WORKHUB app catalog filters by the current server-side membership role", () => {
  assert.ok(keys("employee").includes("travel-request"));
  assert.ok(keys("employee").includes("expense-settlement"));
  assert.ok(!keys("employee").includes("admin-portal"));
  assert.ok(!keys("employee").includes("approval-tasks"));
  assert.ok(keys("manager").includes("approval-tasks"));
  assert.ok(!keys("manager").includes("travel-request"));
  assert.ok(keys("accounting").includes("expense-settlement"));
  assert.ok(!keys("accounting").includes("admin-portal"));
  assert.ok(keys("system_admin").includes("admin-portal"));
});

test("unknown role and absent membership cannot expose reference app names", () => {
  assert.deepEqual(listWorkhubApps(""), []);
  assert.deepEqual(listWorkhubApps("superuser"), []);
});

test("unconnected reference apps have no launch path; live paths are internal-only", () => {
  for (const role of ["newcomer", "employee", "manager", "accounting", "corporate", "system_admin"]) {
    const apps = listWorkhubApps(role);
    assert.ok(apps.some(app => app.key === "announcements"));
    assert.equal(apps.find(app => app.key === "directory")?.availability, "unavailable");
    for (const app of apps) {
      if (app.availability === "unavailable") assert.equal(app.launchTarget, null);
      else assert.match(app.launchTarget ?? "", /^\/(?:#workhub-[a-z-]+|admin)$/u);
      assert.ok(!("allowedRoles" in app), "authorization policy must not be in the public API projection");
    }
  }
});
