import assert from "node:assert/strict";
import test from "node:test";
import { listWorkhubApps, searchWorkhubApps, selectWorkhubHomeShortcuts, type WorkhubAppEntry } from "../src/reference/workhub/app-catalog";

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

test("global Apps search reuses the current authorized catalog and routes only connected apps", () => {
  const aoi = searchWorkhubApps("employee", "出張");
  assert.deepEqual(aoi.map(result => result.resourceId), ["travel-request", "expense-settlement"]);
  assert.deepEqual(aoi[0], {
    resourceType: "workhub_app",
    resourceId: "travel-request",
    category: "apps",
    title: "出張申請",
    snippet: "出張を申請する",
    actionTarget: "/#workhub-requests",
  });
  assert.deepEqual(searchWorkhubApps("employee", "管理ポータル"), []);
  assert.deepEqual(searchWorkhubApps("system_admin", "管理ポータル").map(result => result.actionTarget), ["/admin"]);
  assert.deepEqual(searchWorkhubApps("manager", "承認").map(result => result.resourceId), ["approval-tasks"]);
});

test("global Apps search reveals neither unauthorized nor unconnected app launch targets", () => {
  for (const role of ["", "unexpected", "employee", "manager", "accounting", "system_admin"]) {
    assert.deepEqual(searchWorkhubApps(role, "社員・組織"), [], "unconnected apps are not executable search hits");
    assert.deepEqual(searchWorkhubApps(role, "　"), [], "empty terms must not enumerate applications");
    for (const result of searchWorkhubApps(role, "社内")) {
      assert.match(result.actionTarget, /^\/(?:#workhub-[a-z-]+|admin)$/u);
    }
  }
  assert.deepEqual(searchWorkhubApps("unexpected", "管理ポータル"), []);
  assert.deepEqual(searchWorkhubApps("employee", "セキュリティ"), []);
});

test("HOME shortcuts are the first four connected apps from the already authorized catalog", () => {
  const employee = selectWorkhubHomeShortcuts(listWorkhubApps("employee"));
  assert.deepEqual(employee.map(app => app.key), ["travel-request", "expense-settlement", "announcements"]);
  assert.ok(employee.every(app => app.availability === "available" && app.launchTarget.startsWith("/")));
  assert.deepEqual(selectWorkhubHomeShortcuts(listWorkhubApps("manager")).map(app => app.key), [
    "approval-tasks", "announcements",
  ]);
  assert.deepEqual(selectWorkhubHomeShortcuts(listWorkhubApps("system_admin")).map(app => app.key), [
    "announcements", "admin-portal",
  ]);
  assert.deepEqual(selectWorkhubHomeShortcuts(listWorkhubApps("unknown")), []);
});

test("HOME shortcuts exclude unavailable and invalid targets and remain capped at four", () => {
  const base = listWorkhubApps("employee").find(app => app.key === "travel-request");
  assert.ok(base);
  const invalid: WorkhubAppEntry[] = [
    { ...base, key: "not-connected", availability: "unavailable", launchTarget: null },
    { ...base, key: "external", launchTarget: "https://invalid.example/" },
    { ...base, key: "script", launchTarget: "javascript:alert(1)" },
  ];
  const authorized = listWorkhubApps("employee");
  const result = selectWorkhubHomeShortcuts([...invalid, ...authorized, ...authorized]);
  assert.equal(result.length, 4);
  assert.ok(result.every(app => app.key !== "not-connected" && app.key !== "external" && app.key !== "script"));
  assert.deepEqual(result.slice(0, 3).map(app => app.key), ["travel-request", "expense-settlement", "announcements"]);
});
